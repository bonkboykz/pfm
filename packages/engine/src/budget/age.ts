import Decimal from 'decimal.js';
import type { DB } from '../db/index.js';

export interface AgeOfMoney {
  /** Средний возраст потраченных денег в днях, округлённый вниз. */
  days: number;
  /** Сколько списаний участвовало в среднем. */
  sampleSize: number;
  /** Дата, на которую посчитано. */
  asOfDate: string;
}

/** Сколько дней прошло между двумя датами вида YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

interface Lot {
  date: string;
  remaining: Decimal;
}

/**
 * Возраст денег — четвёртое правило YNAB, «старь свои деньги».
 *
 * Сколько дней в среднем тенге пролежал на счетах до того, как его потратили.
 * Каждое списание разбирает самые старые непотраченные поступления (FIFO), и
 * его возраст — взвешенное среднее по разобранным партиям. Метрика — среднее
 * по последним `sampleSize` списаниям: она должна показывать, как дела сейчас,
 * иначе давняя история навсегда придавит любое улучшение.
 *
 * Что считается движением денег: всё, что вошло на бюджетные счета и вышло с
 * них. Переводы между двумя своими бюджетными счетами не считаются ничем —
 * деньги не пришли и не ушли, они переложились, и стареть от этого не
 * перестают. Перевод через границу бюджета, наоборот, считается: он несёт
 * категорию именно потому, что деньги периметр покинули.
 *
 * Возвраты и прочие приходы по категориям пополняют очередь наравне с
 * доходом: с точки зрения возраста важно, когда деньги оказались на счету, а
 * не как они назывались.
 *
 * `null`, когда мерить нечего: нет поступлений, нет трат или траты нечем
 * покрыть. Выдумывать ноль нельзя — ноль здесь означает «живёшь ровно с
 * колёс», а это утверждение о финансах, а не об отсутствии данных.
 */
export function getAgeOfMoney(
  db: DB,
  asOfDate?: string,
  sampleSize = 10,
): AgeOfMoney | null {
  const until = asOfDate ?? new Date().toISOString().slice(0, 10);

  const rows = db.$client.prepare(`
    SELECT t.date AS date, t.amount_cents AS amount
    FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN accounts b ON b.id = t.transfer_account_id
    WHERE a.on_budget = 1 AND t.is_deleted = 0
      AND t.date <= ?
      AND NOT (t.transfer_account_id IS NOT NULL AND b.on_budget = 1)
    ORDER BY t.date, t.rowid
  `).all(until) as { date: string; amount: number }[];

  const lots: Lot[] = [];
  const ages: number[] = [];

  for (const row of rows) {
    if (row.amount > 0) {
      lots.push({ date: row.date, remaining: new Decimal(row.amount) });
      continue;
    }

    let left = new Decimal(row.amount).negated();
    let weighted = new Decimal(0);
    let matched = new Decimal(0);

    while (left.greaterThan(0) && lots.length > 0) {
      const lot = lots[0];
      const take = Decimal.min(left, lot.remaining);

      weighted = weighted.plus(take.times(daysBetween(lot.date, row.date)));
      matched = matched.plus(take);
      left = left.minus(take);
      lot.remaining = lot.remaining.minus(take);

      if (lot.remaining.lessThanOrEqualTo(0)) lots.shift();
    }

    // Списание, которое нечем покрыть, возраста не имеет: этих денег в
    // бюджете никогда не было. Считать его нулём значило бы записать пробел
    // в данных как достижение «трачу с колёс».
    if (matched.greaterThan(0)) {
      ages.push(weighted.div(matched).toNumber());
    }
  }

  if (ages.length === 0) return null;

  const sample = ages.slice(-sampleSize);
  const average = sample.reduce((acc, a) => acc + a, 0) / sample.length;

  return { days: Math.floor(average), sampleSize: sample.length, asOfDate: until };
}
