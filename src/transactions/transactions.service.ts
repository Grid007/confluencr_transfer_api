import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DuplicateTransactionError,
  TransactionNotFoundError,
  UniqueViolationError,
} from '../common/errors/app.exception.js';
import { InjectDb, type Db } from '../database/database.constants.js';
import { transactions } from '../database/schema/index.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { toTransactionResponse, type TransactionResponse } from '../ledger/ledger.mapper.js';
import type { CreateTransactionBody } from './transactions.schemas.js';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly ledger: LedgerService,
    @InjectDb() private readonly db: Db,
  ) {}

  async create(body: CreateTransactionBody): Promise<TransactionResponse> {
    try {
      return await this.ledger.run(async (tx) => {
        const { byId, postedAt } = await this.ledger.lockAccounts(tx, [{ id: body.account_id }]);
        const row = await this.ledger.postEntry(
          tx,
          byId.get(body.account_id)!,
          {
            accountId: body.account_id,
            type: body.type,
            amount: body.amount,
            referenceId: body.reference_id,
            description: body.description,
          },
          postedAt,
        );
        return toTransactionResponse(row);
      });
    } catch (err) {
      // Backstop: the UNIQUE constraint fired anyway. Report it exactly like the normal duplicate path.
      if (err instanceof UniqueViolationError) {
        const existing = await this.ledger.findTransactionByReference(
          this.db,
          body.account_id,
          body.reference_id,
        );
        if (existing) {
          throw new DuplicateTransactionError(body.reference_id, toTransactionResponse(existing));
        }
      }
      throw err;
    }
  }

  async get(id: string): Promise<TransactionResponse> {
    const [row] = await this.db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
    if (!row) throw new TransactionNotFoundError(id);
    return toTransactionResponse(row);
  }
}
