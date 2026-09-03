import { describe, it, expect } from 'vitest';
import { createDb, type DB } from '../src/db/index.js';
import { initializeDatabase } from '../src/db/ddl.js';
import { splitLoanPayment, getLoanCurrentDebt } from '../src/loan/engine.js';

/**
 * Разнесение платежа по кредиту на проценты и тело.
 *
 * Платёж уходит одной суммой, а долг уменьшается лишь на свою часть. Считаем
 * по факту: проценты начисляются на фактический остаток за фактическое число
 * дней с прошлого платежа, остальное идёт в тело. График амортизации для
 * этого не годится — он предполагает, что платят ровно по расписанию, а при
 * частичном досрочном погашении расходится с жизнью с первого же взноса.
 *
 * Больше заплатил — больше ушло в тело, и следующий платёж начисляет проценты
 * уже на меньший остаток. Ради этого всё и делается.
 */

const NOW = '2026-01-01T00:00:00.000Z';

function seed(): DB {
  const db = createDb(':memory:');
  initializeDatabase(db.$client);
  return db;
}

function loan(
  db: DB,
  id: string,
  { principal, aprBps, startDate, paidOff = 0 }:
    { principal: number; aprBps: number; startDate: string; paidOff?: number },
) {
  db.$client
    .prepare(
      `INSERT INTO loans (id, name, type, principal_cents, apr_bps, term_months,
         start_date, monthly_payment_cents, payment_day, penalty_rate_bps,
         early_repayment_fee_cents, paid_off_cents, is_active, created_at, updated_at)
       VALUES (?, ?, 'loan', ?, ?, 60, ?, 10000000, 3, 0, 0, ?, 1, ?, ?)`,
    )
    .run(id, id, principal, aprBps, startDate, paidOff, NOW, NOW);
  return id;
}

describe('разнесение платежа по кредиту', () => {
  it('беспроцентная рассрочка уходит в тело целиком', () => {
    const db = seed();
    loan(db, 'installment', { principal: 10000000, aprBps: 0, startDate: '2026-01-01' });

    const split = splitLoanPayment(db, 'installment', '2026-02-03', 1000000);

    expect(split.interestCents).toBe(0);
    expect(split.principalCents).toBe(1000000);
  });

  it('проценты считаются от остатка за фактические дни', () => {
    // 1 000 000 ₸ под 36,5% годовых — это ровно 1000 ₸ в день.
    // За 10 дней 10 000 ₸ процентов, остальное в тело.
    const db = seed();
    loan(db, 'cash', { principal: 100000000, aprBps: 3650, startDate: '2026-01-01' });

    const split = splitLoanPayment(db, 'cash', '2026-01-11', 5000000);

    expect(split.daysAccrued).toBe(10);
    expect(split.interestCents).toBe(1000000);
    expect(split.principalCents).toBe(4000000);
  });

  it('уже погашенное тело уменьшает проценты следующего платежа', () => {
    // Тот же кредит, но половина тела уже закрыта: проценты вдвое меньше.
    const db = seed();
    loan(db, 'cash', {
      principal: 100000000, aprBps: 3650, startDate: '2026-01-01', paidOff: 50000000,
    });

    const split = splitLoanPayment(db, 'cash', '2026-01-11', 5000000);

    expect(split.interestCents).toBe(500000);
    expect(split.principalCents).toBe(4500000);
  });

  it('платёж меньше процентов не уменьшает тело', () => {
    // Тело не растёт: капитализации в этой модели нет, и придумывать её,
    // чтобы закрыть дыру в расчёте, значило бы менять условия кредита.
    const db = seed();
    loan(db, 'cash', { principal: 100000000, aprBps: 3650, startDate: '2026-01-01' });

    const split = splitLoanPayment(db, 'cash', '2026-01-11', 500000);

    expect(split.interestCents).toBe(500000);
    expect(split.principalCents).toBe(0);
    expect(split.coversInterest).toBe(false);
  });

  it('платёж до даты выдачи процентов не начисляет', () => {
    const db = seed();
    loan(db, 'cash', { principal: 100000000, aprBps: 3650, startDate: '2026-01-10' });

    const split = splitLoanPayment(db, 'cash', '2026-01-05', 1000000);

    expect(split.daysAccrued).toBe(0);
    expect(split.interestCents).toBe(0);
    expect(split.principalCents).toBe(1000000);
  });

  it('остаток до и после платежа виден в ответе', () => {
    const db = seed();
    loan(db, 'cash', { principal: 100000000, aprBps: 3650, startDate: '2026-01-01' });

    const split = splitLoanPayment(db, 'cash', '2026-01-11', 5000000);

    expect(split.outstandingBeforeCents).toBe(100000000);
    expect(split.outstandingAfterCents).toBe(96000000);
  });

  it('неизвестный кредит — ошибка, а не молчаливый ноль', () => {
    const db = seed();
    expect(() => splitLoanPayment(db, 'нет такого', '2026-01-11', 1000000)).toThrow();
  });

  it('долг не уходит ниже нуля при переплате', () => {
    const db = seed();
    loan(db, 'small', { principal: 1000000, aprBps: 0, startDate: '2026-01-01' });

    const split = splitLoanPayment(db, 'small', '2026-02-01', 1500000);

    expect(split.principalCents).toBe(1000000);
    expect(split.outstandingAfterCents).toBe(0);
    expect(getLoanCurrentDebt(db, 'small')).toBe(1000000);
  });
});
