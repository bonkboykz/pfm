import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { type DB, categories, categoryGroups } from '@pfm/engine';
import { notFound, validationError } from '../errors.js';

const createGroupSchema = z.object({
  name: z.string().min(1),
});

const createCategorySchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1),
  targetAmountCents: z.number().int().optional(),
  targetType: z.enum(['none', 'monthly_funding', 'target_balance', 'target_by_date']).optional(),
  targetDate: z.string().optional(),
  note: z.string().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  targetAmountCents: z.number().int().nullable().optional(),
  targetType: z.enum(['none', 'monthly_funding', 'target_balance', 'target_by_date']).optional(),
  targetDate: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export function categoryRoutes(db: DB) {
  const router = new Hono();

  // GET / — grouped categories (exclude system/hidden)
  router.get('/', (c) => {
    const groups = db
      .select()
      .from(categoryGroups)
      .where(and(eq(categoryGroups.isSystem, false), eq(categoryGroups.isHidden, false)))
      .orderBy(categoryGroups.sortOrder)
      .all();

    const cats = db
      .select()
      .from(categories)
      .where(and(eq(categories.isSystem, false), eq(categories.isHidden, false)))
      .orderBy(categories.sortOrder)
      .all();

    const result = groups.map((g) => ({
      id: g.id,
      name: g.name,
      sortOrder: g.sortOrder,
      categories: cats
        .filter((cat) => cat.groupId === g.id)
        .map((cat) => ({
          id: cat.id,
          name: cat.name,
          groupId: cat.groupId,
          targetAmountCents: cat.targetAmountCents,
          targetType: cat.targetType,
          targetDate: cat.targetDate,
          sortOrder: cat.sortOrder,
          note: cat.note,
        })),
    }));

    return c.json(result);
  });

  // POST /groups — create category group
  router.post('/groups', async (c) => {
    const body = await c.req.json();
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const created = db
      .insert(categoryGroups)
      .values({ name: parsed.data.name })
      .returning()
      .get();

    return c.json(created, 201);
  });

  // POST / — create category
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const group = db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.id, parsed.data.groupId))
      .get();
    if (!group) throw notFound('CategoryGroup', parsed.data.groupId);

    const created = db
      .insert(categories)
      .values({
        groupId: parsed.data.groupId,
        name: parsed.data.name,
        targetAmountCents: parsed.data.targetAmountCents ?? null,
        targetType: parsed.data.targetType ?? 'none',
        targetDate: parsed.data.targetDate ?? null,
        note: parsed.data.note ?? null,
      })
      .returning()
      .get();

    return c.json(created, 201);
  });

  // PATCH /:id — update category
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const cat = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!cat) throw notFound('Category', id);
    if (cat.isSystem) {
      throw validationError('Cannot modify system category');
    }

    const body = await c.req.json();
    const parsed = updateCategorySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    db.update(categories).set(parsed.data).where(eq(categories.id, id)).run();

    const updated = db.select().from(categories).where(eq(categories.id, id)).get()!;
    return c.json(updated);
  });

  // DELETE /:id — soft delete (hide)
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const cat = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!cat) throw notFound('Category', id);
    if (cat.isSystem) {
      throw validationError('Cannot delete system category');
    }

    db.update(categories).set({ isHidden: true }).where(eq(categories.id, id)).run();

    return c.json({ success: true });
  });

  return router;
}
