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
  /**
   * Вхождения, для которых операция уже была заведена руками. Ничего не
   * создано, но дата сдвинута: платёж действительно состоялся.
   *
   * Суммы отдаются обе — фактическая и ожидавшаяся, — потому что совпадение
   * ищется без учёта суммы, и расхождение стоит видеть.
   */
  matched: {
    scheduledId: string;
    date: string;
    transactionId: string;
    amountCents: number;
    expectedAmountCents: number;
  }[];
  errors: { scheduledId: string; message: string }[];
}
