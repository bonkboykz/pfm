import { Hono } from 'hono';
import { isoDate } from '../validation.js';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  type DB,
  accounts,
  getAccountBalances,
  reconcileAccount,
  formatMoney,
} from '@pfm/engine';
import { notFound, validationError, conflict } from '../errors.js';

const reconcileSchema = z.object({
  actualBalanceCents: z.number().int(),
  date: isoDate().optional(),
  memo: z.string().optional(),
});

const createAccountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['checking', 'savings', 'credit_card', 'cash', 'line_of_credit', 'tracking']),
  onBudget: z.boolean().optional(),
  currency: z.string().optional(),
  note: z.string().optional(),
  bankName: z.string().optional(),
  last4Digits: z.string().length(4).regex(/^\d{4}$/).optional(),
  cardType: z.enum(['visa', 'mastercard', 'amex', 'unionpay', 'mir', 'other']).optional(),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).optional(),
  onBudget: z.boolean().optional(),
  currency: z.string().optional(),
  sortOrder: z.number().int().optional(),
  note: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  last4Digits: z.string().length(4).regex(/^\d{4}$/).nullable().optional(),
  cardType: z.enum(['visa', 'mastercard', 'amex', 'unionpay', 'mir', 'other']).nullable().optional(),
  /** Возврат из архива. Без него архивация была ловушкой:
   * закрыл по ошибке — и починить можно только через базу. */
  isActive: z.boolean().optional(),
});

function formatAccountBalance(ab: { accountId: string; accountName: string; type: string; balanceCents: number; clearedCents: number; unclearedCents: number }, currency = 'KZT') {
  return {
    ...ab,
    balanceFormatted: formatMoney(ab.balanceCents, currency),
    clearedFormatted: formatMoney(ab.clearedCents, currency),
    unclearedFormatted: formatMoney(ab.unclearedCents, currency),
  };
}


/**
 * Счёт в чужой валюте не может участвовать в бюджете.
 *
 * Движок складывает минорные единицы, не глядя на валюту: 100 юаней и
 * 100 тенге для него одно число. Пока такие счета вне бюджета, это безвредно —
 * выборки фильтруют `on_budget = 1`. Включённый в бюджет валютный счёт
 * заставил бы RTA врать молча, без единой ошибки.
 *
 * Настоящая поддержка валют — курсы на дату и переоценка остатков — отдельная
 * работа. До неё честнее запретить, чем считать неправильно.
 */
function requireBudgetCurrency(currency: string, onBudget: boolean): void {
  if (!onBudget || currency === BUDGET_CURRENCY) return;

  throw validationError(
    `Счёт в валюте ${currency} не может быть в бюджете: движок складывает суммы ` +
      `как ${BUDGET_CURRENCY}, и остаток исказил бы Ready to Assign. ` +
      'Держите его вне бюджета (onBudget: false) — он останется в списке счетов ' +
      'и в чистой стоимости, но не будет участвовать в распределении.',
  );
}

const BUDGET_CURRENCY = 'KZT';

export function accountRoutes(db: DB) {
  const router = new Hono();

  // GET / — list accounts with balances (?includeInactive=true for closed ones)
  router.get('/', (c) => {
    const includeInactive = c.req.query('includeInactive') === 'true';

    const accts = includeInactive
      ? db.select().from(accounts).orderBy(accounts.sortOrder).all()
      : db.select().from(accounts).where(eq(accounts.isActive, true)).orderBy(accounts.sortOrder).all();

    // getAccountBalances covers active accounts only. A deactivated account
    // keeps its transactions, and those still move Ready to Assign, so its
    // balance has to be computable or the totals look unexplainable.
    const balances = getAccountBalances(db);
    const balanceOf = (id: string) => {
      const known = balances.find((b) => b.accountId === id);
      if (known) return known;
      const row = db.$client.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN cleared IN ('cleared','reconciled') THEN amount_cents ELSE 0 END), 0) as cleared,
          COALESCE(SUM(CASE WHEN cleared = 'uncleared' THEN amount_cents ELSE 0 END), 0) as uncleared
        FROM transactions WHERE account_id = ? AND is_deleted = 0
      `).get(id) as { cleared: number; uncleared: number };
      return {
        accountId: id,
        clearedCents: row.cleared,
        unclearedCents: row.uncleared,
        balanceCents: row.cleared + row.uncleared,
      };
    };

    const result = accts.map((acct) => {
      const bal = balanceOf(acct.id);
      return {
        id: acct.id,
        name: acct.name,
        type: acct.type,
        onBudget: acct.onBudget,
        currency: acct.currency,
        isActive: acct.isActive,
        sortOrder: acct.sortOrder,
        balanceCents: bal.balanceCents,
        balanceFormatted: formatMoney(bal.balanceCents, acct.currency),
        clearedCents: bal.clearedCents,
        clearedFormatted: formatMoney(bal.clearedCents, acct.currency),
        unclearedCents: bal.unclearedCents,
        unclearedFormatted: formatMoney(bal.unclearedCents, acct.currency),
      };
    });

    return c.json(result);
  });

  // POST /:id/reconcile — one adjustment transaction to match the real balance
  router.post('/:id/reconcile', async (c) => {
    const id = c.req.param('id');
    const acct = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!acct) throw notFound('Account', id);

    const body = await c.req.json();
    const parsed = reconcileSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const result = reconcileAccount(
      db,
      id,
      parsed.data.actualBalanceCents,
      parsed.data.date ?? new Date().toISOString().slice(0, 10),
      parsed.data.memo,
    );

    return c.json({
      accountId: id,
      accountName: acct.name,
      previousBalanceCents: result.previousBalanceCents,
      previousBalanceFormatted: formatMoney(result.previousBalanceCents, acct.currency),
      actualBalanceCents: parsed.data.actualBalanceCents,
      actualBalanceFormatted: formatMoney(parsed.data.actualBalanceCents, acct.currency),
      adjustmentCents: result.adjustmentCents,
      adjustmentFormatted: formatMoney(result.adjustmentCents, acct.currency),
      transactionId: result.transactionId,
    });
  });

  // POST / — create account
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;
    const onBudget = data.type === 'tracking' ? false : (data.onBudget ?? true);
    requireBudgetCurrency(data.currency ?? BUDGET_CURRENCY, onBudget);

    const created = db
      .insert(accounts)
      .values({
        name: data.name,
        type: data.type,
        onBudget,
        currency: data.currency ?? 'KZT',
        note: data.note ?? null,
        bankName: data.bankName ?? null,
        last4Digits: data.last4Digits ?? null,
        cardType: data.cardType ?? null,
      })
      .returning()
      .get();

    return c.json(created, 201);
  });

  // GET /:id — single account with balance
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const acct = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!acct) throw notFound('Account', id);

    const balances = getAccountBalances(db);
    const bal = balances.find((b) => b.accountId === id);

    return c.json({
      id: acct.id,
      name: acct.name,
      type: acct.type,
      onBudget: acct.onBudget,
      currency: acct.currency,
      // Без этого по карточке счёта не понять, архивный он или живой.
      isActive: acct.isActive,
      sortOrder: acct.sortOrder,
      balanceCents: bal?.balanceCents ?? 0,
      balanceFormatted: formatMoney(bal?.balanceCents ?? 0, acct.currency),
      clearedCents: bal?.clearedCents ?? 0,
      clearedFormatted: formatMoney(bal?.clearedCents ?? 0, acct.currency),
      unclearedCents: bal?.unclearedCents ?? 0,
      unclearedFormatted: formatMoney(bal?.unclearedCents ?? 0, acct.currency),
    });
  });

  // PATCH /:id — update account
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const acct = db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!acct) throw notFound('Account', id);

    const body = await c.req.json();
    const parsed = updateAccountSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    // Проверяем то состояние, которое получится после правки: запрет обходится
    // и включением счёта в бюджет, и сменой валюты у уже включённого.
    requireBudgetCurrency(
      parsed.data.currency ?? acct.currency,
      parsed.data.onBudget ?? acct.onBudget,
    );

    db.update(accounts)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    const updated = db.select().from(accounts).where(eq(accounts.id, id)).get()!;
    return c.json(updated);
  });

  // DELETE /:id — soft delete
  // DELETE — архивация. С ?purge=true — удаление насовсем, но только если
  // терять нечего: операции счёта и переводы на него держат его в истории, и
  // молча унести их вместе со счётом значило бы порвать эту историю.
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const purge = c.req.query('purge') === 'true';

    const acct = db.select().from(accounts).where(eq(accounts.id, id)).get();
    // Архивировать можно только живой счёт; удалять — и уже архивный тоже,
    // иначе до мусора, заведённого по ошибке, не добраться вовсе.
    if (!acct || (!purge && !acct.isActive)) throw notFound('Account', id);

    if (purge) {
      const used = db.$client
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM transactions WHERE account_id = ?) AS own,
             (SELECT COUNT(*) FROM transactions WHERE transfer_account_id = ?) AS inbound,
             (SELECT COUNT(*) FROM loans WHERE account_id = ?) AS loans,
             (SELECT COUNT(*) FROM deposits WHERE account_id = ?) AS deposits,
             (SELECT COUNT(*) FROM scheduled_transactions
               WHERE account_id = ? OR transfer_account_id = ?) AS scheduled`,
        )
        .get(id, id, id, id, id, id) as Record<string, number>;

      const held = Object.entries(used).filter(([, n]) => n > 0);
      if (held.length > 0) {
        const what = held.map(([k, n]) => `${k}: ${n}`).join(', ');
        throw conflict(
          `Счёт "${acct.name}" удалить нельзя, на нём держится история (${what}). ` +
            'Операции ушли бы вместе с ним.',
          'Архивируйте: DELETE без ?purge=true — счёт исчезнет из списков, история останется.',
        );
      }

      db.delete(accounts).where(eq(accounts.id, id)).run();
      return c.json({ success: true, purged: true });
    }

    db.update(accounts)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(accounts.id, id))
      .run();

    return c.json({ success: true, purged: false });
  });

  return router;
}
