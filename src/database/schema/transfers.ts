import { sql } from 'drizzle-orm';
import { check, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const transfers = pgTable(
  'transfers',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceAccountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    destinationAccountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    amount: numeric({ precision: 19, scale: 2 }).notNull(),
    description: text(),
    referenceId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique('transfers_source_reference_uq').on(t.sourceAccountId, t.referenceId),
    check('transfers_distinct_accounts', sql`${t.sourceAccountId} <> ${t.destinationAccountId}`),
    check('transfers_amount_positive', sql`${t.amount} > 0`),
    check('transfers_reference_length', sql`char_length(${t.referenceId}) between 1 and 128`),
    check(
      'transfers_description_length',
      sql`${t.description} is null or char_length(${t.description}) between 1 and 255`,
    ),
  ],
);

export type TransferRow = typeof transfers.$inferSelect;
