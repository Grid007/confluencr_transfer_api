import { Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { AccountNotFoundError } from '../common/errors/app.exception.js';
import { buildMeta, offsetFor, type PageMeta } from '../common/pagination/pagination.schema.js';
import { InjectDb, type Db } from '../database/database.constants.js';
import { accounts, transactions, type AccountRow } from '../database/schema/index.js';
import { toTransactionResponse, type TransactionResponse } from '../ledger/ledger.mapper.js';
import type { AccountResponse, BalanceResponse, HistoryQuery } from './accounts.schemas.js';

export const toAccountResponse = (row: AccountRow): AccountResponse => ({
  id: row.id,
  name: row.name,
  balance: row.balance,
  created_at: row.createdAt.toISOString(),
});

@Injectable()
export class AccountsService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** The balance always starts at 0: the column default applies because the insert never names it. */
  async create(name: string): Promise<AccountResponse> {
    const [row] = await this.db.insert(accounts).values({ name }).returning();
    return toAccountResponse(row!);
  }

  async get(id: string): Promise<AccountResponse> {
    return toAccountResponse(await this.require(id));
  }

  async balance(id: string): Promise<BalanceResponse> {
    const row = await this.require(id);
    return { account_id: row.id, balance: row.balance };
  }

  /** Newest first (created_at DESC, seq DESC). Rows and total come from one statement (one snapshot). */
  async history(
    id: string,
    query: HistoryQuery,
  ): Promise<{ data: TransactionResponse[]; meta: PageMeta }> {
    await this.require(id);
    const { page, limit, type } = query;
    const where = type
      ? and(eq(transactions.accountId, id), eq(transactions.type, type))
      : eq(transactions.accountId, id);

    const rows = await this.db
      .select({ ...getTableColumns(transactions), total: sql<string>`count(*) over()` })
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.createdAt), desc(transactions.seq))
      .limit(limit)
      .offset(offsetFor(page, limit));

    let total = rows.length > 0 ? Number(rows[0]!.total) : 0;
    if (rows.length === 0 && page > 1) {
      // Past the last page there is no row to carry the window count; ask for it explicitly.
      const [counted] = await this.db
        .select({ total: sql<string>`count(*)` })
        .from(transactions)
        .where(where);
      total = Number(counted?.total ?? 0);
    }
    return {
      data: rows.map((row) => toTransactionResponse(row)),
      meta: buildMeta(page, limit, total),
    };
  }

  private async require(id: string): Promise<AccountRow> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    if (!row) throw new AccountNotFoundError([{ id }]);
    return row;
  }
}
