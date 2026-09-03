import { eq, and, gte, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import type { DB } from '../db/index.js';
import { loans, transactions } from '../db/schema.js';
import type { LoanSummary, AmortizationEntry } from './types.js';
import type { DebtSnapshot } from '../debt/types.js';

/**
 * Остаток долга: тело минус погашенное, и только.
 *
 * Раньше отсюда вычиталась ещё и активность привязанной категории, и платёж
 * уходил в минус дважды — через `paidOffCents` и через транзакцию. На
 * беспроцентных рассрочках это не всплывало: транзакций в их категориях нет.
 *
 * Но ошибка глубже двойного счёта. Платёж по кредиту под процент состоит из
 * тела и процентов, а долг уменьшается только на тело: 136 648,65 ₸ списания
 * против 35 855,21 ₸ тела. Вычитать из долга всю сумму платежа неверно даже
 * там, где `paidOffCents` никто не трогает.
 *
 * Разложить платёж без графика амортизации нельзя, поэтому долг опирается на
 * `paidOffCents`, а фактические списания отдаются отдельно
 * ([getLoanPaymentsObserved]) — расхождение должно быть видно, а не спрятано.
 * Автоматическое разнесение — отдельная задача (PFM-49).
 */
export function getLoanCurrentDebt(db: DB, loanId: string): number {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return 0;

  // `paidOffCents` — это то, что было погашено до того, как кредит завели в
  // системе: у большинства займов история началась раньше учёта. Всё, что
  // гасится дальше, живёт разнесением на самих платежах, поэтому удаление
  // платежа возвращает долг на место, а не оставляет его заниженным навсегда.
  const posted = db.$client
    .prepare(
      `SELECT COALESCE(SUM(loan_principal_cents), 0) AS total
       FROM transactions WHERE loan_id = ? AND is_deleted = 0`,
    )
    .get(loanId) as { total: number };

  return Math.max(0, loan.principalCents - loan.paidOffCents - posted.total);
}

/**
 * Сколько реально ушло по привязанной категории с даты старта кредита —
 * тело вместе с процентами.
 *
 * Считается от `startDate`: категория переиспользуется между кредитами, и
 * траты, предшествующие этому кредиту, принадлежат тому, который он сменил.
 */
export interface LoanPaymentSplit {
  /** Часть платежа, уменьшившая тело долга. */
  principalCents: number;
  /** Часть, ушедшая на проценты, начисленные с прошлого платежа. */
  interestCents: number;
  /** Дней, за которые начислены проценты. */
  daysAccrued: number;
  /** Хватило ли платежа на проценты. */
  coversInterest: boolean;
  outstandingBeforeCents: number;
  outstandingAfterCents: number;
}

const DAYS_IN_YEAR = 365;

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Разносит платёж на проценты и тело — по факту, а не по графику.
 *
 * Проценты начисляются на фактический остаток за фактическое число дней с
 * прошлого платежа (actual/365), остальное уменьшает тело. График амортизации
 * для этого не годится: он предполагает, что платят ровно по расписанию, и при
 * первом же частичном досрочном погашении расходится с жизнью. Заплатил
 * больше — больше ушло в тело, и следующий платёж начисляет проценты уже на
 * меньший остаток; ровно ради этого считаем от факта.
 *
 * Платёж меньше начисленных процентов тело не уменьшает, но и не увеличивает:
 * капитализации в этой модели нет, а придумать её, чтобы закрыть дыру в
 * расчёте, значило бы поменять условия кредита. Недоплаченные проценты нигде
 * не копятся — для этого нужен отдельный учёт просрочки и пени.
 *
 * Ничего не записывает: расчёт отделён от проведения, чтобы его можно было
 * показать до подтверждения.
 */
export function splitLoanPayment(
  db: DB,
  loanId: string,
  date: string,
  amountCents: number,
): LoanPaymentSplit {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) throw new Error(`Unknown loan: ${loanId}`);

  const outstanding = new Decimal(getLoanCurrentDebt(db, loanId));

  const since = lastPaymentDate(db, loanId) ?? loan.startDate;
  const days = daysBetween(since, date);

  const interest = outstanding
    .times(loan.aprBps)
    .div(10000)
    .times(days)
    .div(DAYS_IN_YEAR)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const payment = new Decimal(Math.abs(amountCents));
  const coversInterest = payment.greaterThanOrEqualTo(interest);

  const interestPart = coversInterest ? interest : payment;
  const principalPart = Decimal.min(
    payment.minus(interestPart),
    outstanding,
  );

  return {
    principalCents: principalPart.toNumber(),
    interestCents: interestPart.toNumber(),
    daysAccrued: days,
    coversInterest,
    outstandingBeforeCents: outstanding.toNumber(),
    outstandingAfterCents: outstanding.minus(principalPart).toNumber(),
  };
}

/** Дата последнего платежа, привязанного к этому кредиту. */
function lastPaymentDate(db: DB, loanId: string): string | null {
  const row = db.$client
    .prepare(
      `SELECT MAX(date) AS d FROM transactions
       WHERE loan_id = ? AND is_deleted = 0`,
    )
    .get(loanId) as { d: string | null } | undefined;
  return row?.d ?? null;
}

/**
 * Сколько по этому кредиту реально заплачено — по проведённым платежам.
 *
 * Раньше считалось по категории с даты старта: другого способа не было. Он
 * оказался негодным, и это видно на живых данных — три рассрочки делили одну
 * категорию (притом удалённую), две карты другую, у кредита наличными её нет
 * вовсе. Из-за этого чужой платёж приписывался соседнему займу. Теперь платёж
 * привязан к кредиту явно, и угадывать больше не нужно: считается ровно то,
 * что провели через проведение платежа.
 */
export function getLoanPaymentsObserved(db: DB, loanId: string): number {
  const result = db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amountCents}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.loanId, loanId),
        eq(transactions.isDeleted, false),
      ),
    )
    .get();

  // Списания отрицательны, поэтому платежи — это сумма со знаком минус.
  return Math.max(0, -(result?.total ?? 0));
}


export function getLoanSummary(db: DB, loanId: string): LoanSummary | null {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return null;

  const currentDebtCents = getLoanCurrentDebt(db, loanId);

  return {
    id: loan.id,
    name: loan.name,
    type: loan.type,
    principalCents: loan.principalCents,
    aprBps: loan.aprBps,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    monthlyPaymentCents: loan.monthlyPaymentCents,
    paymentDay: loan.paymentDay,
    currentDebtCents,
    isActive: loan.isActive,
  };
}

export function loanToDebtSnapshot(db: DB, loanId: string): DebtSnapshot | null {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return null;

  const currentDebtCents = getLoanCurrentDebt(db, loanId);

  return {
    id: loan.id,
    name: loan.name,
    type: loan.type === 'credit_line' ? 'credit_card' : loan.type,
    balanceCents: currentDebtCents,
    aprBps: loan.aprBps,
    minPaymentCents: loan.monthlyPaymentCents,
    remainingInstallments: loan.type === 'installment'
      ? Math.ceil(currentDebtCents / loan.monthlyPaymentCents)
      : undefined,
  };
}

export function generateAmortizationSchedule(db: DB, loanId: string): AmortizationEntry[] {
  const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
  if (!loan) return [];

  const schedule: AmortizationEntry[] = [];
  let balance = loan.principalCents;
  const monthlyRate = loan.aprBps > 0
    ? new Decimal(loan.aprBps).div(10000).div(12)
    : new Decimal(0);

  const [startYear, startMonth] = loan.startDate.split('-').map(Number);

  for (let i = 1; i <= loan.termMonths && balance > 0; i++) {
    const month = ((startMonth - 1 + i) % 12) + 1;
    const year = startYear + Math.floor((startMonth - 1 + i) / 12);
    const date = `${year}-${String(month).padStart(2, '0')}`;

    const startBalance = balance;

    let interestCents = 0;
    if (loan.aprBps > 0) {
      interestCents = new Decimal(balance).times(monthlyRate).round().toNumber();
    }

    const payment = Math.min(loan.monthlyPaymentCents, balance + interestCents);
    const principalPaid = payment - interestCents;
    balance = Math.max(0, startBalance - principalPaid);

    schedule.push({
      month: i,
      date,
      startBalanceCents: startBalance,
      principalCents: principalPaid,
      interestCents,
      paymentCents: payment,
      endBalanceCents: balance,
    });
  }

  return schedule;
}
