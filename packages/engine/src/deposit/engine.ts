import { eq, and, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import type { DB } from '../db/index.js';
import { deposits, transactions } from '../db/schema.js';
import type {
  DepositSummary,
  InterestScheduleEntry,
  KdifExposure,
  DepositCompareConfig,
  DepositComparisonEntry,
} from './types.js';

const KDIF_GUARANTEE_LIMIT_CENTS = 1_500_000_000; // 15 000 000 ₸

export function getDepositCurrentBalance(db: DB, depositId: string): number {
  const deposit = db.select().from(deposits).where(eq(deposits.id, depositId)).get();
  if (!deposit) return 0;

  if (!deposit.accountId) {
    return deposit.initialAmountCents + deposit.topUpCents;
  }

  const result = db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amountCents}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, deposit.accountId),
        eq(transactions.isDeleted, false),
      ),
    )
    .get();

  return result?.total ?? 0;
}

export function computeEffectiveAnnualRate(
  rateBps: number,
  capitalization: 'monthly' | 'quarterly' | 'at_end' | 'none',
): number {
  if (capitalization === 'none') return rateBps;

  const nominalRate = new Decimal(rateBps).div(10000);
  let n: number;
  switch (capitalization) {
    case 'monthly':
      n = 12;
      break;
    case 'quarterly':
      n = 4;
      break;
    case 'at_end':
      n = 1;
      break;
  }

  // EAR = (1 + r/n)^n - 1
  const ear = new Decimal(1).plus(nominalRate.div(n)).pow(n).minus(1);
  return ear.times(10000).round().toNumber();
}

export function generateInterestSchedule(
  db: DB,
  depositId: string,
  months?: number,
): InterestScheduleEntry[] {
  const deposit = db.select().from(deposits).where(eq(deposits.id, depositId)).get();
  if (!deposit) return [];

  return generateScheduleFromConfig(
    {
      initialAmountCents: deposit.initialAmountCents + deposit.topUpCents,
      annualRateBps: deposit.annualRateBps,
      termMonths: deposit.termMonths,
      capitalization: deposit.capitalization,
      startDate: deposit.startDate,
    },
    months,
  );
}

function generateScheduleFromConfig(
  config: {
    initialAmountCents: number;
    annualRateBps: number;
    termMonths: number;
    capitalization: 'monthly' | 'quarterly' | 'at_end' | 'none';
    startDate: string;
  },
  months?: number,
): InterestScheduleEntry[] {
  const schedule: InterestScheduleEntry[] = [];
  const totalMonths = config.termMonths > 0 ? config.termMonths : (months ?? 12);
  const monthlyRate = new Decimal(config.annualRateBps).div(10000).div(12);

  let balance = config.initialAmountCents;
  let cumulativeInterest = 0;
  let accruedNotCapitalized = 0;

  const [startYear, startMonth] = config.startDate.split('-').map(Number);

  for (let i = 1; i <= totalMonths; i++) {
    const month = ((startMonth - 1 + i) % 12) + 1;
    const year = startYear + Math.floor((startMonth - 1 + i) / 12);
    const date = `${year}-${String(month).padStart(2, '0')}`;

    const startBalance = balance;
    const interestCents = new Decimal(balance).times(monthlyRate).round().toNumber();
    cumulativeInterest += interestCents;

    let capitalizedCents = 0;

    switch (config.capitalization) {
      case 'monthly':
        capitalizedCents = interestCents;
        balance += capitalizedCents;
        break;
      case 'quarterly':
        accruedNotCapitalized += interestCents;
        if (i % 3 === 0 || i === totalMonths) {
          capitalizedCents = accruedNotCapitalized;
          balance += capitalizedCents;
          accruedNotCapitalized = 0;
        }
        break;
      case 'at_end':
        accruedNotCapitalized += interestCents;
        if (i === totalMonths) {
          capitalizedCents = accruedNotCapitalized;
          balance += capitalizedCents;
          accruedNotCapitalized = 0;
        }
        break;
      case 'none':
        // Simple interest — balance stays the same, interest is paid out
        break;
    }

    schedule.push({
      month: i,
      date,
      startBalanceCents: startBalance,
      interestCents,
      capitalizedCents,
      endBalanceCents: balance,
      cumulativeInterestCents: cumulativeInterest,
    });
  }

  return schedule;
}

export function getDepositSummary(db: DB, depositId: string): DepositSummary | null {
  const deposit = db.select().from(deposits).where(eq(deposits.id, depositId)).get();
  if (!deposit) return null;

  const currentBalanceCents = getDepositCurrentBalance(db, depositId);
  const schedule = generateInterestSchedule(db, depositId);
  const projectedInterestCents = schedule.length > 0
    ? schedule[schedule.length - 1].cumulativeInterestCents
    : 0;
  const effectiveAnnualRateBps = computeEffectiveAnnualRate(
    deposit.annualRateBps,
    deposit.capitalization,
  );

  return {
    id: deposit.id,
    name: deposit.name,
    bankName: deposit.bankName,
    type: deposit.type,
    initialAmountCents: deposit.initialAmountCents,
    currentBalanceCents,
    projectedInterestCents,
    effectiveAnnualRateBps,
    annualRateBps: deposit.annualRateBps,
    termMonths: deposit.termMonths,
    startDate: deposit.startDate,
    endDate: deposit.endDate,
    capitalization: deposit.capitalization,
    isWithdrawable: deposit.isWithdrawable,
    isReplenishable: deposit.isReplenishable,
    minBalanceCents: deposit.minBalanceCents,
    isActive: deposit.isActive,
  };
}

export function getKdifExposure(db: DB): KdifExposure[] {
  const activeDeposits = db
    .select()
    .from(deposits)
    .where(eq(deposits.isActive, true))
    .all();

  const byBank = new Map<string, { totalCents: number; count: number }>();

  for (const dep of activeDeposits) {
    const existing = byBank.get(dep.bankName) ?? { totalCents: 0, count: 0 };
    existing.totalCents += dep.initialAmountCents + dep.topUpCents;
    existing.count += 1;
    byBank.set(dep.bankName, existing);
  }

  const result: KdifExposure[] = [];
  for (const [bankName, data] of byBank) {
    const excessCents = Math.max(0, data.totalCents - KDIF_GUARANTEE_LIMIT_CENTS);
    result.push({
      bankName,
      totalDepositsCents: data.totalCents,
      depositCount: data.count,
      guaranteeLimitCents: KDIF_GUARANTEE_LIMIT_CENTS,
      isOverInsured: excessCents > 0,
      excessCents,
    });
  }

  return result;
}

export function compareDeposits(configs: DepositCompareConfig[]): {
  deposits: DepositComparisonEntry[];
  recommended: string;
  explanation: string;
} {
  const entries: DepositComparisonEntry[] = configs.map((config, idx) => {
    const schedule = generateScheduleFromConfig(
      {
        ...config,
        startDate: new Date().toISOString().slice(0, 10),
      },
      config.termMonths > 0 ? undefined : 12,
    );

    const totalInterestCents = schedule.length > 0
      ? schedule[schedule.length - 1].cumulativeInterestCents
      : 0;
    const finalBalanceCents = schedule.length > 0
      ? schedule[schedule.length - 1].endBalanceCents
      : config.initialAmountCents;
    const effectiveAnnualRateBps = computeEffectiveAnnualRate(
      config.annualRateBps,
      config.capitalization,
    );

    return {
      id: String(idx + 1),
      name: config.name,
      initialAmountCents: config.initialAmountCents,
      totalInterestCents,
      effectiveAnnualRateBps,
      finalBalanceCents,
      schedule,
    };
  });

  // Find best by total interest earned
  let best = entries[0];
  for (const entry of entries) {
    if (entry.totalInterestCents > best.totalInterestCents) {
      best = entry;
    }
  }

  return {
    deposits: entries,
    recommended: best.name,
    explanation: `"${best.name}" earns the most interest (effective rate ${new Decimal(best.effectiveAnnualRateBps).div(100).toFixed(2)}%).`,
  };
}
