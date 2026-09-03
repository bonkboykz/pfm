import { z } from 'zod';

/**
 * Месяц и дата должны существовать, а не просто выглядеть похоже.
 *
 * `^\d{4}-\d{2}$` пропускал 2026-13 и 2026-00, а `^\d{4}-\d{2}-\d{2}$` —
 * 31 февраля и 45-е число. Дальше такие значения ведут себя правдоподобно:
 * сравнение строк работает, границы месяца «-01»/«-31» строятся, запись
 * ложится в базу. Опечатка возвращалась пустым бюджетом или всплывала месяцы
 * спустя кривой сортировкой — то есть в момент, когда связать её с вводом
 * уже нельзя.
 */
export const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

const dateShape = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Существует ли такой день в календаре. 29 февраля 2028 — да, 2027 — нет. */
export function isRealDate(value: string): boolean {
  const m = dateShape.exec(value);
  if (!m) return false;

  const [, y, mo, d] = m;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;

  // Round-trip: Date молча переносит 31 апреля на 1 мая, и без сверки
  // обратно такая дата прошла бы как настоящая.
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() + 1 === Number(mo) &&
    date.getUTCDate() === Number(d)
  );
}

/** Zod-схема календарной даты YYYY-MM-DD. */
export const isoDate = () =>
  z.string().refine(isRealDate, 'date must be a real calendar date, YYYY-MM-DD');

/** Zod-схема месяца YYYY-MM. */
export const isoMonth = () =>
  z.string().regex(monthRegex, 'month must be YYYY-MM with a real month number');
