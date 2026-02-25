export interface DepositSummary {
  id: string;
  name: string;
  bankName: string;
  type: 'term' | 'savings' | 'demand';
  initialAmountCents: number;
  currentBalanceCents: number;
  projectedInterestCents: number;
  effectiveAnnualRateBps: number;
  annualRateBps: number;
  termMonths: number;
  startDate: string;
  endDate: string | null;
  capitalization: string;
  isWithdrawable: boolean;
  isReplenishable: boolean;
  minBalanceCents: number;
  isActive: boolean;
}

export interface InterestScheduleEntry {
  month: number;
  date: string;
  startBalanceCents: number;
  interestCents: number;
  capitalizedCents: number;
  endBalanceCents: number;
  cumulativeInterestCents: number;
}

export interface KdifExposure {
  bankName: string;
  totalDepositsCents: number;
  depositCount: number;
  guaranteeLimitCents: number;
  isOverInsured: boolean;
  excessCents: number;
}

export interface DepositComparisonEntry {
  id: string;
  name: string;
  initialAmountCents: number;
  totalInterestCents: number;
  effectiveAnnualRateBps: number;
  finalBalanceCents: number;
  schedule: InterestScheduleEntry[];
}

export interface DepositCompareConfig {
  name: string;
  initialAmountCents: number;
  annualRateBps: number;
  termMonths: number;
  capitalization: 'monthly' | 'quarterly' | 'at_end' | 'none';
}
