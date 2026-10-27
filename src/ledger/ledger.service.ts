import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../config/env.schema.js';
import {
  AccountNotFoundError,
  type AccountRef,
  DuplicateTransactionError,
  InsufficientBalanceError,
} from '../common/errors/app.exception.js';
import { translatePgError } from '../common/errors/pg-error.js';
import { lt, shortfall } from '../common/money/money.js';
import { InjectDb, type Db, type Tx } from '../database/database.constants.js';
import {
  accounts,
  transactions,
  type AccountRow,
  type TransactionRow,
  type TransactionType,
} from '../database/schema/index.js';
import { toTransactionResponse } from './ledger.mapper.js';

export interface Entry {
  accountId: string;
  type: TransactionType;
  amount: string;
  referenceId: string;
  description: string | null;
  transferId?: string | null;
}

export interface Locked {
  byId: Map<string, AccountRow>;
  /** One database-clock instant (ms precision) shared by every row the operation writes. */
  postedAt: Date;
}

/**
 * The only code that changes a balance or inserts a ledger row. Both plain transactions and
 * transfers go through it, so every money movement obeys the same protocol:
 *
 *   BEGIN (READ COMMITTED)
 *     lock account row(s) FOR NO KEY UPDATE, ascending id order   -> serialises per account, no deadlocks
 *     read clock_timestamp() AFTER the lock                        -> history order == posting order
 *     duplicate check, then balance check (both under the lock)
 *     UPDATE accounts SET balance = balance +/- amount
 *     INSERT ledger row(s) with balance_after
 *   COMMIT
 *
 * UNIQUE / CHECK constraints and immutability triggers are the second line of defence.
 */
@Injectable()
export class LedgerService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Runs `work` in one database transaction with bounded lock/statement waits (transaction-local). */
  async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const lockMs = this.config.get('DB_LOCK_TIMEOUT_MS', { infer: true });
    const statementMs = this.config.get('DB_STATEMENT_TIMEOUT_MS', { infer: true });
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`select
          set_config('lock_timeout', ${`${lockMs}ms`}, true),
          set_config('statement_timeout', ${`${statementMs}ms`}, true),
          set_config('idle_in_transaction_session_timeout', ${`${statementMs}ms`}, true)`);
        return work(tx);
      });
    } catch (err) {
      throw translatePgError(err);
    }
  }

  /** Locks every referenced account in ascending id order; reports all missing accounts at once. */
  async lockAccounts(tx: Tx, refs: readonly AccountRef[]): Promise<Locked> {
    const ids = [...new Set(refs.map((r) => r.id))];
    const rows = await tx
      .select()
      .from(accounts)
      .where(inArray(accounts.id, ids))
      .orderBy(asc(accounts.id))
      .for('no key update');
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = refs.filter((r) => !byId.has(r.id));
    if (missing.length > 0) throw new AccountNotFoundError(missing);

    // to_char keeps exact millisecond text; Drizzle's raw execute() returns timestamps as strings.
    const [clock] = await tx.execute<{ now: string }>(
      sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`,
    );
    return { byId, postedAt: new Date(clock!.now) };
  }

  async findTransactionByReference(
    executor: Db | Tx,
    accountId: string,
    referenceId: string,
  ): Promise<TransactionRow | undefined> {
    const [row] = await executor
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.referenceId, referenceId)))
      .limit(1);
    return row;
  }

  /** Duplicate `reference_id` for the account -> 409 carrying the existing transaction. */
  async assertNoDuplicate(tx: Tx, accountId: string, referenceId: string): Promise<void> {
    const existing = await this.findTransactionByReference(tx, accountId, referenceId);
    if (existing) throw new DuplicateTransactionError(referenceId, toTransactionResponse(existing));
  }

  /** Exact decimal comparison against the locked balance (equality is allowed: debit down to 0.00). */
  assertSufficient(account: AccountRow, amount: string): void {
    if (lt(account.balance, amount)) {
      throw new InsufficientBalanceError({
        accountId: account.id,
        balance: account.balance,
        requested: amount,
        shortfall: shortfall(account.balance, amount),
      });
    }
  }

  /** Moves the balance in SQL (no JS arithmetic) and appends the immutable ledger row. */
  async applyEntry(tx: Tx, entry: Entry, postedAt: Date): Promise<TransactionRow> {
    const next =
      entry.type === 'credit'
        ? sql`${accounts.balance} + ${entry.amount}::numeric`
        : sql`${accounts.balance} - ${entry.amount}::numeric`;
    const [updated] = await tx
      .update(accounts)
      .set({ balance: next })
      .where(eq(accounts.id, entry.accountId))
      .returning({ balance: accounts.balance });

    const [row] = await tx
      .insert(transactions)
      .values({
        accountId: entry.accountId,
        type: entry.type,
        amount: entry.amount,
        description: entry.description,
        referenceId: entry.referenceId,
        balanceAfter: updated!.balance,
        transferId: entry.transferId ?? null,
        createdAt: postedAt,
      })
      .returning();
    return row!;
  }

  /** Precondition: the account row is locked in `tx`. Duplicate check precedes the balance check. */
  async postEntry(
    tx: Tx,
    account: AccountRow,
    entry: Entry,
    postedAt: Date,
  ): Promise<TransactionRow> {
    await this.assertNoDuplicate(tx, entry.accountId, entry.referenceId);
    if (entry.type === 'debit') this.assertSufficient(account, entry.amount);
    return this.applyEntry(tx, entry, postedAt);
  }
}
