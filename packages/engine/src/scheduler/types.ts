export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface ScheduledTransaction {
  id: string;
  accountId: string;
  accountName: string;
  frequency: Frequency;
  nextDate: string;
  amountCents: number;
  amountFormatted: string;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  transferAccountId: string | null;
  transferAccountName: string | null;
  memo: string | null;
  /** Создаётся ли операция автоматически; false — правило-напоминание. */
  autoPost: boolean;
  isActive: boolean;
}

export interface ProcessResult {
  created: number;
  transactions: { id: string; scheduledId: string; date: string }[];
  /**
   * Наступившие правила с выключенным автопроведением: операция не создана и
   * дата не сдвинута. Возвращаются явно, а не пропускаются молча — иначе
   * «проведено 0» выглядело бы как «нечего проводить».
   */
  reminders: { scheduledId: string; date: string }[];
  errors: { scheduledId: string; message: string }[];
}
