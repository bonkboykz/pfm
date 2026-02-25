import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  type: text('type', {
    enum: ['checking', 'savings', 'credit_card', 'cash', 'line_of_credit', 'tracking'],
  }).notNull(),
  onBudget: integer('on_budget', { mode: 'boolean' }).notNull().default(true),
  currency: text('currency').notNull().default('KZT'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const categoryGroups = sqliteTable('category_groups', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  groupId: text('group_id').notNull().references(() => categoryGroups.id),
  name: text('name').notNull(),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  targetAmountCents: integer('target_amount_cents'),
  targetType: text('target_type', {
    enum: ['none', 'monthly_funding', 'target_balance', 'target_by_date'],
  }).default('none'),
  targetDate: text('target_date'),
  sortOrder: integer('sort_order').notNull().default(0),
  isHidden: integer('is_hidden', { mode: 'boolean' }).notNull().default(false),
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const payees = sqliteTable('payees', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull().unique(),
  lastCategoryId: text('last_category_id').references(() => categories.id),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  accountId: text('account_id').notNull().references(() => accounts.id),
  date: text('date').notNull(),
  amountCents: integer('amount_cents').notNull(),
  payeeId: text('payee_id').references(() => payees.id),
  payeeName: text('payee_name'),
  categoryId: text('category_id').references(() => categories.id),
  transferAccountId: text('transfer_account_id').references(() => accounts.id),
  transferTransactionId: text('transfer_transaction_id'),
  memo: text('memo'),
  cleared: text('cleared', {
    enum: ['uncleared', 'cleared', 'reconciled'],
  }).notNull().default('uncleared'),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(true),
  isDeleted: integer('is_deleted', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('idx_tx_account_date').on(table.accountId, table.date),
  index('idx_tx_category').on(table.categoryId),
  index('idx_tx_date').on(table.date),
  index('idx_tx_transfer').on(table.transferTransactionId),
]);

export const monthlyBudgets = sqliteTable('monthly_budgets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  categoryId: text('category_id').notNull().references(() => categories.id),
  month: text('month').notNull(),
  assignedCents: integer('assigned_cents').notNull().default(0),
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('idx_budget_cat_month').on(table.categoryId, table.month),
]);

export const scheduledTransactions = sqliteTable('scheduled_transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  accountId: text('account_id').notNull().references(() => accounts.id),
  frequency: text('frequency', {
    enum: ['weekly', 'biweekly', 'monthly', 'yearly']
  }).notNull(),
  nextDate: text('next_date').notNull(),
  amountCents: integer('amount_cents').notNull(),
  payeeName: text('payee_name'),
  categoryId: text('category_id').references(() => categories.id),
  transferAccountId: text('transfer_account_id').references(() => accounts.id),
  memo: text('memo'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => [
  index('idx_sched_next_date').on(table.nextDate),
  index('idx_sched_active').on(table.isActive),
]);
