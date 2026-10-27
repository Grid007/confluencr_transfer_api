import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';
import { transfers } from './transfers.js';

export const transactionType = pgEnum('transaction_type', ['credit', 'debit']);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Monotonic tiebreaker for "latest first"; never exposed through the API.
    seq: bigint({ mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    type: transactionType().notNull(),
    amount: numeric({ precision: 19, scale: 2 }).notNull(),
    description: text(),
    referenceId: text().notNull(),
    balanceAfter: numeric({ precision: 19, scale: 2 }).notNull(),
    transferId: uuid().references(() => transfers.id, { onDelete: 'restrict' }),
    // No DB default on purpose: the service assigns clock_timestamp() after taking the row lock,
    // so both legs of a transfer share one instant.
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique('transactions_account_reference_uq').on(t.accountId, t.referenceId),
    index('transactions_account_created_idx').on(t.accountId, t.createdAt.desc(), t.seq.desc()),
    index('transactions_account_type_created_idx').on(
      t.accountId,
      t.type,
      t.createdAt.desc(),
      t.seq.desc(),
    ),
    uniqueIndex('transactions_transfer_leg_uq')
      .on(t.transferId, t.type)
      .where(sql`${t.transferId} is not null`),
    check('transactions_amount_positive', sql`${t.amount} > 0`),
    check('transactions_balance_after_non_negative', sql`${t.balanceAfter} >= 0`),
    check('transactions_reference_length', sql`char_length(${t.referenceId}) between 1 and 128`),
    check(
      'transactions_description_length',
      sql`${t.description} is null or char_length(${t.description}) between 1 and 255`,
    ),
  ],
);

export type TransactionRow = typeof transactions.$inferSelect;
export type TransactionType = (typeof transactionType.enumValues)[number];
