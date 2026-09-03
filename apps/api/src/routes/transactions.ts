import { Hono } from 'hono';
import { isoDate } from '../validation.js';
import { z } from 'zod';
import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  type DB,
  accounts,
  categories,
  transactions,
  payees,
  formatMoney,
} from '@pfm/engine';
import { notFound, validationError, unknownReference } from '../errors.js';

/**
 * Rejects a category id that does not resolve.
 *
 * Transactions used to store whatever string arrived, and a bad id produced a
 * row that no category query would ever return — money that left an account and
 * appeared in no budget line.
 */
function requireCategoryRef(db: DB, categoryId: string) {
  const cat = db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).get();
  if (!cat) throw unknownReference('categoryId', categoryId, 'GET /api/v1/categories');
}

function requireAccountRef(db: DB, accountId: string) {
  const acct = db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get();
  if (!acct) throw unknownReference('accountId', accountId, 'GET /api/v1/accounts');
}

/**
 * Покупка, номинированная не в валюте счёта: что было в чеке и по какому курсу
 * это записали. Курс — тиыны за одну единицу валюты, 464,02 ₸/$ → 46402.
 * Валюта без суммы бессмысленна, поэтому идут только парой.
 */
const foreignAmountFields = {
  originalAmountCents: z.number().int().optional(),
  originalCurrency: z.string().length(3).optional(),
  quotedRateCents: z.number().int().positive().optional(),
  isEstimated: z.boolean().optional(),
};

function requireForeignPair(data: {
  originalAmountCents?: number;
  originalCurrency?: string;
}) {
  const hasAmount = data.originalAmountCents !== undefined;
  const hasCurrency = data.originalCurrency !== undefined;
  if (hasAmount !== hasCurrency) {
    throw validationError(
      'originalAmountCents and originalCurrency go together: an amount without a currency, or a currency without an amount, describes nothing',
    );
  }
}

const createTransactionSchema = z.object({
  accountId: z.string().min(1),
  date: isoDate(),
  amountCents: z.number().int(),
  payeeName: z.string().optional(),
  categoryId: z.string().optional(),
  transferAccountId: z.string().optional(),
  memo: z.string().optional(),
  cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
  ...foreignAmountFields,
});

const updateTransactionSchema = z.object({
  date: isoDate().optional(),
  amountCents: z.number().int().optional(),
  payeeName: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
  ...foreignAmountFields,
});

const bulkCreateSchema = z.object({
  transactions: z.array(createTransactionSchema.omit({ transferAccountId: true })).min(1).max(1000),
  skipDuplicates: z.boolean().optional().default(false),
});

const importSchema = z.object({
  accountId: z.string().min(1),
  csv: z.string().min(1),
  dateColumn: z.string().optional(),
  amountColumn: z.string().optional(),
  payeeColumn: z.string().optional(),
  memoColumn: z.string().optional(),
  dryRun: z.boolean().optional().default(false),
});

interface ParsedRow {
  lineNumber: number;
  date: string;
  amountCents: number;
  payeeName: string | null;
  memo: string | null;
}

/**
 * Finds a stored transaction matching on account, date, amount and payee — the
 * fields a bank statement reproduces identically on every re-export.
 */
function findDuplicate(
  db: DB,
  r: { accountId: string; date: string; amountCents: number; payeeName?: string | null },
): string | null {
  const row = db.$client.prepare(`
    SELECT id FROM transactions
    WHERE account_id = ? AND date = ? AND amount_cents = ?
      AND LOWER(COALESCE(payee_name, '')) = LOWER(?)
      AND is_deleted = 0
    LIMIT 1
  `).get(r.accountId, r.date, r.amountCents, r.payeeName ?? '') as { id: string } | undefined;

  return row?.id ?? null;
}

/** Splits one CSV line, honouring double-quoted fields and doubled quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === ';') {
      out.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field.trim());
  return out;
}

/** Accepts 2026-08-07, 07.08.2026 and 07/08/2026; anything else is rejected. */
function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Parses a bank amount into integer tiyns.
 *
 * Statements use spaces or non-breaking spaces as thousand separators and
 * either a comma or a dot as the decimal mark, and wrap debits in parentheses.
 */
function parseAmountToCents(raw: string): number | null {
  let s = raw.replace(/[\s  ]/g, '').replace(/[^\d,.\-()]/g, '').trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const decimalAt = Math.max(lastComma, lastDot);

  let whole = s;
  let frac = '';
  // Two digits after the final separator means it is the decimal mark; three
  // means it was a thousands separator all along.
  if (decimalAt !== -1 && s.length - decimalAt - 1 <= 2) {
    whole = s.slice(0, decimalAt);
    frac = s.slice(decimalAt + 1);
  }

  whole = whole.replace(/[,.]/g, '');
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return null;
  if (!whole && !frac) return null;

  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

function parseCsv(
  csv: string,
  cols: { dateColumn?: string; amountColumn?: string; payeeColumn?: string; memoColumn?: string },
): ParsedRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row');

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/^﻿/, ''));

  const findCol = (explicit: string | undefined, candidates: string[], label: string) => {
    if (explicit) {
      const i = header.indexOf(explicit.toLowerCase());
      if (i === -1) throw new Error(`Column '${explicit}' not found. Header: ${header.join(', ')}`);
      return i;
    }
    for (const cand of candidates) {
      const i = header.findIndex((h) => h.includes(cand));
      if (i !== -1) return i;
    }
    throw new Error(`Could not find a ${label} column. Header: ${header.join(', ')}. Pass ${label}Column explicitly.`);
  };

  const dateIdx = findCol(cols.dateColumn, ['date', 'дата'], 'date');
  const amountIdx = findCol(cols.amountColumn, ['amount', 'сумма'], 'amount');

  const optionalCol = (explicit: string | undefined, candidates: string[]) => {
    if (explicit) {
      const i = header.indexOf(explicit.toLowerCase());
      return i === -1 ? -1 : i;
    }
    for (const cand of candidates) {
      const i = header.findIndex((h) => h.includes(cand));
      if (i !== -1) return i;
    }
    return -1;
  };

  const payeeIdx = optionalCol(cols.payeeColumn, ['payee', 'description', 'получател', 'назначен', 'операц']);
  const memoIdx = optionalCol(cols.memoColumn, ['memo', 'note', 'коммент', 'примечан']);

  const rows: ParsedRow[] = [];
  const problems: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const date = normalizeDate(cells[dateIdx] ?? '');
    const amountCents = parseAmountToCents(cells[amountIdx] ?? '');

    if (date === null) { problems.push(`line ${i + 1}: unparseable date '${cells[dateIdx] ?? ''}'`); continue; }
    if (amountCents === null) { problems.push(`line ${i + 1}: unparseable amount '${cells[amountIdx] ?? ''}'`); continue; }

    rows.push({
      lineNumber: i + 1,
      date,
      amountCents,
      payeeName: payeeIdx === -1 ? null : (cells[payeeIdx] || null),
      memo: memoIdx === -1 ? null : (cells[memoIdx] || null),
    });
  }

  // A statement that mostly fails to parse means the wrong columns were picked;
  // importing the surviving handful would quietly lose the rest.
  if (problems.length && problems.length > rows.length) {
    throw new Error(`Most rows failed to parse: ${problems.slice(0, 5).join('; ')}`);
  }

  return rows;
}

function resolvePayee(db: DB, payeeName: string | undefined, categoryId: string | undefined | null) {
  if (!payeeName) return { payeeId: null, payeeName: null };

  const existing = db.select().from(payees).where(eq(payees.name, payeeName)).get();

  if (existing) {
    if (categoryId) {
      db.update(payees).set({ lastCategoryId: categoryId }).where(eq(payees.id, existing.id)).run();
    }
    return { payeeId: existing.id, payeeName };
  }

  const created = db
    .insert(payees)
    .values({
      name: payeeName,
      lastCategoryId: categoryId ?? null,
    })
    .returning()
    .get();

  return { payeeId: created.id, payeeName };
}

/**
 * Последняя категория этого плательщика.
 *
 * `last_category_id` писался с первого дня и не читался нигде: база знала, что
 * «Магнум» это продукты, и молчала об этом на каждой новой операции. Это
 * подсказка, а не правило — она применяется только когда категорию не назвали.
 */
function suggestCategory(db: DB, payeeName: string | undefined | null): string | null {
  if (!payeeName) return null;

  const payee = db
    .select({ lastCategoryId: payees.lastCategoryId })
    .from(payees)
    .where(eq(payees.name, payeeName))
    .get();

  if (!payee?.lastCategoryId) return null;

  // Скрытую категорию не предлагаем: её убрали с глаз, и молча возвращать её
  // на новой операции значит воскрешать то, что пользователь закрыл. Удалённой
  // категории может уже не быть вовсе — тогда ссылка тоже мертва.
  const category = db
    .select({ id: categories.id, isHidden: categories.isHidden })
    .from(categories)
    .where(eq(categories.id, payee.lastCategoryId))
    .get();

  return category && !category.isHidden ? category.id : null;
}

/**
 * Валюта живёт на счёте, а не на операции, поэтому её приходится подтягивать
 * отдельно. Счетов единицы, так что дешевле вычитать все разом, чем делать
 * запрос на строку списка.
 */
function accountCurrencies(db: DB): Map<string, string> {
  const rows = db
    .select({ id: accounts.id, currency: accounts.currency })
    .from(accounts)
    .all();
  return new Map(rows.map((r) => [r.id, r.currency]));
}

function formatTx(tx: any, currencies?: Map<string, string>) {
  const currency = currencies?.get(tx.accountId) ?? 'KZT';
  return {
    ...tx,
    amountFormatted: formatMoney(tx.amountCents, currency),
    // Исходная сумма показывается в СВОЕЙ валюте — это то, что было в чеке.
    originalAmountFormatted:
      tx.originalAmountCents == null
        ? null
        : formatMoney(tx.originalAmountCents, tx.originalCurrency ?? 'KZT'),
  };
}

/** Одна операция — один счёт, весь список тянуть незачем. */
function formatOneTx(db: DB, tx: any) {
  const acct = db
    .select({ currency: accounts.currency })
    .from(accounts)
    .where(eq(accounts.id, tx.accountId))
    .get();
  return formatTx(tx, new Map([[tx.accountId, acct?.currency ?? 'KZT']]));
}

export function transactionRoutes(db: DB) {
  const router = new Hono();

  // GET / — list with filters
  router.get('/', (c) => {
    const accountId = c.req.query('accountId');
    const categoryId = c.req.query('categoryId');
    const since = c.req.query('since');
    const until = c.req.query('until');
    const estimated = c.req.query('estimated');
    const limit = parseInt(c.req.query('limit') ?? '50');

    const conditions = [eq(transactions.isDeleted, false)];
    // Суммы, записанные по прогнозному курсу и ждущие выписки.
    if (estimated === 'true') conditions.push(eq(transactions.isEstimated, true));
    if (estimated === 'false') conditions.push(eq(transactions.isEstimated, false));
    if (accountId) conditions.push(eq(transactions.accountId, accountId));
    if (categoryId) conditions.push(eq(transactions.categoryId, categoryId));
    if (since) conditions.push(gte(transactions.date, since));
    if (until) conditions.push(lte(transactions.date, until));

    const rows = db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.date))
      .limit(limit)
      .all();

    const currencies = accountCurrencies(db);
    return c.json(rows.map((r) => formatTx(r, currencies)));
  });

  // POST / — create transaction or transfer
  router.post('/', async (c) => {
    const body = await c.req.json();
    const parsed = createTransactionSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;
    requireForeignPair(data);

    // Validate source account
    const sourceAcct = db.select().from(accounts).where(eq(accounts.id, data.accountId)).get();
    if (!sourceAcct) throw unknownReference('accountId', data.accountId, 'GET /api/v1/accounts');
    if (data.categoryId) requireCategoryRef(db, data.categoryId);
    if (data.categoryId && !data.transferAccountId && !sourceAcct.onBudget) {
      throw validationError(
        `Счёт "${sourceAcct.name}" вне бюджета, его операции не относятся к категориям. ` +
          'Сейчас такая категория просто игнорируется, но включение счёта в бюджет ' +
          'превратило бы её в трату задним числом.',
      );
    }

    // Transfer flow
    if (data.transferAccountId) {
      const targetAcct = db.select().from(accounts).where(eq(accounts.id, data.transferAccountId)).get();
      if (!targetAcct) throw unknownReference('transferAccountId', data.transferAccountId, 'GET /api/v1/accounts');

      // Пересёк ли перевод границу бюджета. Если да — деньги её покинули или
      // вошли в неё, и это трата или доход, а не перекладывание.
      const crossesBoundary = sourceAcct.onBudget !== targetAcct.onBudget;

      if (crossesBoundary && !data.categoryId) {
        throw validationError(
          'Перевод между бюджетным и внебюджетным счётом требует categoryId: ' +
            'деньги покидают бюджет, и без категории они пропали бы из него незаметно. ' +
            'Для прихода извне подойдёт "ready-to-assign".',
        );
      }

      if (!crossesBoundary && data.categoryId) {
        throw validationError(
          'Перевод между двумя счетами по одну сторону бюджета не принимает categoryId: ' +
            'ничего не потрачено, деньги лишь переложены.',
        );
      }

      // Категория живёт на бюджетной стороне пары — только её видит бюджет.
      const categoryOnSource = crossesBoundary && sourceAcct.onBudget ? data.categoryId ?? null : null;
      const categoryOnTarget = crossesBoundary && targetAcct.onBudget ? data.categoryId ?? null : null;

      const tx1Id = createId();
      const tx2Id = createId();
      const now = new Date().toISOString();

      db.insert(transactions)
        .values({
          id: tx1Id,
          accountId: data.accountId,
          date: data.date,
          amountCents: data.amountCents,
          payeeName: `Transfer: ${targetAcct.name}`,
          categoryId: categoryOnSource,
          transferAccountId: data.transferAccountId,
          transferTransactionId: tx2Id,
          memo: data.memo ?? null,
          cleared: data.cleared ?? 'uncleared',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.insert(transactions)
        .values({
          id: tx2Id,
          accountId: data.transferAccountId,
          date: data.date,
          amountCents: -data.amountCents,
          payeeName: `Transfer: ${sourceAcct.name}`,
          categoryId: categoryOnTarget,
          transferAccountId: data.accountId,
          transferTransactionId: tx1Id,
          memo: data.memo ?? null,
          cleared: data.cleared ?? 'uncleared',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const tx1 = db.select().from(transactions).where(eq(transactions.id, tx1Id)).get()!;
      const tx2 = db.select().from(transactions).where(eq(transactions.id, tx2Id)).get()!;

      const currencies = accountCurrencies(db);
      return c.json([formatTx(tx1, currencies), formatTx(tx2, currencies)], 201);
    }

    // Regular transaction
    const categoryId = data.categoryId ?? suggestCategory(db, data.payeeName);
    const { payeeId, payeeName } = resolvePayee(db, data.payeeName, data.categoryId);

    const created = db
      .insert(transactions)
      .values({
        accountId: data.accountId,
        date: data.date,
        amountCents: data.amountCents,
        payeeId,
        payeeName,
        categoryId,
        memo: data.memo ?? null,
        cleared: data.cleared ?? 'uncleared',
        originalAmountCents: data.originalAmountCents ?? null,
        originalCurrency: data.originalCurrency ?? null,
        quotedRateCents: data.quotedRateCents ?? null,
        isEstimated: data.isEstimated ?? false,
      })
      .returning()
      .get();

    return c.json(formatOneTx(db, created), 201);
  });

  // POST /bulk — many transactions in one all-or-nothing write
  router.post('/bulk', async (c) => {
    const body = await c.req.json();
    const parsed = bulkCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const { transactions: rows, skipDuplicates } = parsed.data;

    // Every reference is checked before a single row is written; a bad id at
    // position 40 must not leave the first 39 committed.
    for (const [i, r] of rows.entries()) {
      try {
        requireAccountRef(db, r.accountId);
        if (r.categoryId) requireCategoryRef(db, r.categoryId);
      } catch (err) {
        (err as Error).message += ` (transactions[${i}])`;
        throw err;
      }
    }

    const created: string[] = [];
    const skipped: Array<{ index: number; reason: string; existingId: string }> = [];

    db.$client.transaction(() => {
      for (const [i, r] of rows.entries()) {
        if (skipDuplicates) {
          const dup = findDuplicate(db, r);
          if (dup) {
            skipped.push({ index: i, reason: 'duplicate', existingId: dup });
            continue;
          }
        }

        const categoryId = r.categoryId ?? suggestCategory(db, r.payeeName);
        const { payeeId, payeeName } = resolvePayee(db, r.payeeName, r.categoryId);
        const id = createId();
        const now = new Date().toISOString();

        db.insert(transactions).values({
          id,
          accountId: r.accountId,
          date: r.date,
          amountCents: r.amountCents,
          payeeId,
          payeeName,
          categoryId,
          memo: r.memo ?? null,
          cleared: r.cleared ?? 'uncleared',
          createdAt: now,
          updatedAt: now,
        }).run();

        created.push(id);
      }
    })();

    return c.json({
      created: created.length,
      skipped: skipped.length,
      transactionIds: created,
      skippedDetail: skipped,
    }, 201);
  });

  // POST /import — CSV in, deduplicated against what is already stored
  router.post('/import', async (c) => {
    const body = await c.req.json();
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const { accountId, csv, dateColumn, amountColumn, payeeColumn, memoColumn, dryRun } = parsed.data;
    requireAccountRef(db, accountId);

    let rows: ParsedRow[];
    try {
      rows = parseCsv(csv, { dateColumn, amountColumn, payeeColumn, memoColumn });
    } catch (err) {
      throw validationError((err as Error).message);
    }

    if (!rows.length) {
      throw validationError('CSV contained no data rows');
    }

    const toInsert: ParsedRow[] = [];
    const duplicates: Array<{ row: number; date: string; amountCents: number; payeeName: string | null; existingId: string }> = [];

    // Deduplication is by date + amount + payee, matched against rows already
    // stored and against earlier rows in this same file, so re-importing an
    // overlapping statement is safe.
    const seenInFile = new Set<string>();

    for (const r of rows) {
      const key = `${r.date}|${r.amountCents}|${(r.payeeName ?? '').toLowerCase()}`;
      const existing = findDuplicate(db, { accountId, ...r });

      if (existing) {
        duplicates.push({ row: r.lineNumber, date: r.date, amountCents: r.amountCents, payeeName: r.payeeName, existingId: existing });
      } else if (seenInFile.has(key)) {
        duplicates.push({ row: r.lineNumber, date: r.date, amountCents: r.amountCents, payeeName: r.payeeName, existingId: 'earlier-row-in-file' });
      } else {
        seenInFile.add(key);
        toInsert.push(r);
      }
    }

    if (dryRun) {
      // Предпросмотр обязан показывать то, что получится: если он молчит о
      // категориях, а импорт их проставляет, предпросмотр врёт.
      return c.json({
        dryRun: true,
        parsed: rows.length,
        wouldImport: toInsert.length,
        wouldCategorise: toInsert.filter((r) => suggestCategory(db, r.payeeName)).length,
        duplicates: duplicates.length,
        duplicateDetail: duplicates,
        preview: toInsert.slice(0, 10).map((r) => ({
          date: r.date,
          amountCents: r.amountCents,
          amountFormatted: formatMoney(r.amountCents),
          payeeName: r.payeeName,
          categoryId: suggestCategory(db, r.payeeName),
          memo: r.memo,
        })),
      });
    }

    const createdIds: string[] = [];
    let categorised = 0;

    db.$client.transaction(() => {
      for (const r of toInsert) {
        const { payeeId, payeeName } = resolvePayee(db, r.payeeName ?? undefined, undefined);
        const categoryId = suggestCategory(db, r.payeeName);
        if (categoryId) categorised++;
        const id = createId();
        const now = new Date().toISOString();

        db.insert(transactions).values({
          id,
          accountId,
          date: r.date,
          amountCents: r.amountCents,
          payeeId,
          payeeName,
          categoryId,
          memo: r.memo ?? null,
          cleared: 'cleared',
          createdAt: now,
          updatedAt: now,
        }).run();

        createdIds.push(id);
      }
    })();

    return c.json({
      dryRun: false,
      parsed: rows.length,
      imported: createdIds.length,
      categorised,
      duplicates: duplicates.length,
      duplicateDetail: duplicates,
      transactionIds: createdIds,
      note: categorised === createdIds.length
        ? 'Every imported row got a category from its payee. Check them before trusting the budget.'
        : `${categorised} of ${createdIds.length} rows got a category from their payee. Assign the rest so they reach the budget.`,
    }, 201);
  });

  // GET /:id — single transaction
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const tx = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .get();
    if (!tx) throw notFound('Transaction', id);

    return c.json(formatOneTx(db, tx));
  });

  // PATCH /:id — update transaction
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const tx = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .get();
    if (!tx) throw notFound('Transaction', id);

    const body = await c.req.json();
    const parsed = updateTransactionSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => i.message).join(', '));
    }

    const data = parsed.data;
    requireForeignPair(data);
    if (data.categoryId) requireCategoryRef(db, data.categoryId);

    const now = new Date().toISOString();

    // Handle payee update
    let payeeUpdate: { payeeId?: string | null; payeeName?: string | null } = {};
    if (data.payeeName !== undefined) {
      const resolved = resolvePayee(db, data.payeeName, data.categoryId ?? tx.categoryId);
      payeeUpdate = resolved;
    }

    const updateFields = {
      ...data,
      ...payeeUpdate,
      updatedAt: now,
    };

    db.update(transactions).set(updateFields).where(eq(transactions.id, id)).run();

    // Sync paired transfer if applicable
    if (tx.transferTransactionId) {
      const pairedUpdate: Record<string, any> = { updatedAt: now };
      if (data.date !== undefined) pairedUpdate.date = data.date;
      if (data.amountCents !== undefined) pairedUpdate.amountCents = -data.amountCents;

      if (Object.keys(pairedUpdate).length > 1) {
        db.update(transactions)
          .set(pairedUpdate)
          .where(eq(transactions.id, tx.transferTransactionId))
          .run();
      }
    }

    const updated = db.select().from(transactions).where(eq(transactions.id, id)).get()!;
    return c.json(formatOneTx(db, updated));
  });

  // DELETE /:id — soft delete
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const tx = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false)))
      .get();
    if (!tx) throw notFound('Transaction', id);

    const now = new Date().toISOString();

    db.update(transactions)
      .set({ isDeleted: true, updatedAt: now })
      .where(eq(transactions.id, id))
      .run();

    // Also soft-delete paired transfer
    if (tx.transferTransactionId) {
      db.update(transactions)
        .set({ isDeleted: true, updatedAt: now })
        .where(eq(transactions.id, tx.transferTransactionId))
        .run();
    }

    return c.json({ success: true });
  });

  return router;
}
