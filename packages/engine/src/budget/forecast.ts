import Decimal from 'decimal.js';
import type { DB } from '../db/index.js';
import { advanceDate } from '../scheduler/engine.js';
import { getCategoryAvailable } from './engine.js';
import type { Frequency } from '../scheduler/types.js';

export interface ForecastOccurrence {
  scheduledId: string;
  date: string;
  amountCents: number;
  payeeName: string | null;
  accountName: string;
}

export interface CategoryForecast {
  categoryId: string;
  categoryName: string;
  groupName: string;
  /** Available at the end of this month, carryover included. */
  availableCents: number;
  /** Net of everything scheduled inside this month; negative means outflow. */
  scheduledNetCents: number;
  /** What Available becomes once the scheduled items land. */
  projectedAvailableCents: number;
  /** How far short, or 0. */
  shortfallCents: number;
  /** The date the running balance first goes negative, if it does. */
  firstShortDate: string | null;
  occurrences: ForecastOccurrence[];
}

export interface MonthForecast {
  month: string;
  categories: CategoryForecast[];
  totalScheduledCents: number;
  totalShortfallCents: number;
  shortCategoryCount: number;
}

export interface BudgetForecast {
  asOfDate: string;
  throughDate: string;
  days: number;
  months: MonthForecast[];
  totalShortfallCents: number;
  /** The earliest date any category runs out. Null when nothing is short. */
  firstShortDate: string | null;
  /** Scheduled items with no category: invisible to the budget by construction. */
  uncategorizedUpcoming: ForecastOccurrence[];
}

interface SchedRow {
  id: string;
  account_id: string;
  account_name: string;
  frequency: Frequency;
  next_date: string;
  amount_cents: number;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  group_name: string | null;
  transfer_account_id: string | null;
}

/** A monthly rule over a year window is 12 rows; the cap is a runaway guard. */
const MAX_OCCURRENCES_PER_RULE = 400;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Answers "which category runs out of money, and when" by pushing scheduled
 * transactions forward against the money already assigned to them.
 *
 * Two things make this more than a subtraction. Scheduled rules repeat, so a
 * horizon longer than a month has to expand each rule into every occurrence it
 * produces. And a payment is settled from the Available of the month it falls
 * in, not the month you are looking at — comparing September's rent against
 * August's Available reports a shortfall that does not exist. Occurrences are
 * therefore bucketed by their own month and measured against that month's
 * Available, which already carries earlier months forward.
 */
export function getBudgetForecast(db: DB, daysAhead = 30, asOfDate?: string): BudgetForecast {
  const asOf = asOfDate ?? new Date().toISOString().slice(0, 10);
  const through = addDays(asOf, daysAhead);

  const rules = db.$client.prepare(`
    SELECT st.id, st.account_id, a.name as account_name, st.frequency, st.next_date,
           st.amount_cents, st.payee_name, st.category_id, st.transfer_account_id,
           c.name as category_name, cg.name as group_name
    FROM scheduled_transactions st
    JOIN accounts a ON a.id = st.account_id
    LEFT JOIN categories c ON c.id = st.category_id
    LEFT JOIN category_groups cg ON cg.id = c.group_id
    WHERE st.is_active = 1
    ORDER BY st.next_date
  `).all() as SchedRow[];

  // month -> categoryId -> occurrences
  const buckets = new Map<string, Map<string, ForecastOccurrence[]>>();
  const uncategorized: ForecastOccurrence[] = [];
  const catMeta = new Map<string, { name: string; group: string }>();

  for (const r of rules) {
    // A transfer moves money between accounts without touching a category, so
    // it can never cause a category to come up short.
    if (r.transfer_account_id) continue;

    let date = r.next_date;
    for (let i = 0; i < MAX_OCCURRENCES_PER_RULE && date <= through; i++) {
      if (date >= asOf) {
        const occ: ForecastOccurrence = {
          scheduledId: r.id,
          date,
          amountCents: r.amount_cents,
          payeeName: r.payee_name,
          accountName: r.account_name,
        };

        if (!r.category_id) {
          uncategorized.push(occ);
        } else {
          const month = date.slice(0, 7);
          if (!buckets.has(month)) buckets.set(month, new Map());
          const byCat = buckets.get(month)!;
          byCat.set(r.category_id, [...(byCat.get(r.category_id) ?? []), occ]);
          catMeta.set(r.category_id, {
            name: r.category_name ?? r.category_id,
            group: r.group_name ?? '',
          });
        }
      }
      date = advanceDate(date, r.frequency);
    }
  }

  const months: MonthForecast[] = [];
  let firstShortDate: string | null = null;
  let totalShortfall = new Decimal(0);

  for (const month of [...buckets.keys()].sort()) {
    const byCat = buckets.get(month)!;
    const categories: CategoryForecast[] = [];
    let monthScheduled = new Decimal(0);
    let monthShortfall = new Decimal(0);

    for (const [categoryId, occurrences] of byCat) {
      occurrences.sort((a, b) => a.date.localeCompare(b.date));

      const available = getCategoryAvailable(db, categoryId, month);
      const net = occurrences.reduce((s, o) => new Decimal(s).plus(o.amountCents).toNumber(), 0);
      const projected = new Decimal(available).plus(net).toNumber();
      const shortfall = projected < 0 ? Math.abs(projected) : 0;

      // Walk the occurrences in date order to find the moment it breaks, which
      // is what tells you the deadline rather than just the amount.
      let running = available;
      let shortDate: string | null = null;
      for (const o of occurrences) {
        running = new Decimal(running).plus(o.amountCents).toNumber();
        if (running < 0) { shortDate = o.date; break; }
      }

      const meta = catMeta.get(categoryId)!;
      categories.push({
        categoryId,
        categoryName: meta.name,
        groupName: meta.group,
        availableCents: available,
        scheduledNetCents: net,
        projectedAvailableCents: projected,
        shortfallCents: shortfall,
        firstShortDate: shortDate,
        occurrences,
      });

      monthScheduled = monthScheduled.plus(net);
      monthShortfall = monthShortfall.plus(shortfall);

      if (shortDate && (firstShortDate === null || shortDate < firstShortDate)) {
        firstShortDate = shortDate;
      }
    }

    // Worst first: the biggest hole is the one worth acting on.
    categories.sort((a, b) => b.shortfallCents - a.shortfallCents || a.categoryName.localeCompare(b.categoryName));

    months.push({
      month,
      categories,
      totalScheduledCents: monthScheduled.toNumber(),
      totalShortfallCents: monthShortfall.toNumber(),
      shortCategoryCount: categories.filter((c) => c.shortfallCents > 0).length,
    });

    totalShortfall = totalShortfall.plus(monthShortfall);
  }

  uncategorized.sort((a, b) => a.date.localeCompare(b.date));

  return {
    asOfDate: asOf,
    throughDate: through,
    days: daysAhead,
    months,
    totalShortfallCents: totalShortfall.toNumber(),
    firstShortDate,
    uncategorizedUpcoming: uncategorized,
  };
}
