import { sql } from 'drizzle-orm';
import { check, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    balance: numeric({ precision: 19, scale: 2 }).notNull().default('0'),
    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`date_trunc('milliseconds', now())`),
  },
  (t) => [
    check('accounts_name_length', sql`char_length(${t.name}) between 1 and 100`),
    check('accounts_balance_non_negative', sql`${t.balance} >= 0`),
  ],
).enableRLS();

export type AccountRow = typeof accounts.$inferSelect;
