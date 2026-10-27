import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  DuplicateTransferError,
  TransferNotFoundError,
  UniqueViolationError,
} from '../common/errors/app.exception.js';
import { InjectDb, type Db, type Tx } from '../database/database.constants.js';
import { transactions, transfers, type TransferRow } from '../database/schema/index.js';
import { toTransferResponse, type TransferResponse } from '../ledger/ledger.mapper.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { CreateTransferBody } from './transfers.schemas.js';

@Injectable()
export class TransfersService {
  constructor(
    private readonly ledger: LedgerService,
    @InjectDb() private readonly db: Db,
  ) {}

  /**
   * One database transaction: lock both accounts (ascending id), check duplicates then balance,
   * insert the transfer row and both legs. Any failure rolls back everything; a partial transfer
   * cannot be persisted.
   */
  async create(body: CreateTransferBody): Promise<TransferResponse> {
    const referenceId = body.reference_id ?? randomUUID();
    const source = body.source_account_id;
    const destination = body.destination_account_id;
    try {
      return await this.ledger.run(async (tx) => {
        const { byId, postedAt } = await this.ledger.lockAccounts(tx, [
          { id: source, field: 'source_account_id' },
          { id: destination, field: 'destination_account_id' },
        ]);

        const existing = await this.findBySourceReference(tx, source, referenceId);
        if (existing) throw new DuplicateTransferError(referenceId, await this.load(tx, existing));

        // Precedence: duplicates on both accounts, then balance, then writes.
        await this.ledger.assertNoDuplicate(tx, source, referenceId);
        await this.ledger.assertNoDuplicate(tx, destination, referenceId);
        this.ledger.assertSufficient(byId.get(source)!, body.amount);

        const [transfer] = await tx
          .insert(transfers)
          .values({
            sourceAccountId: source,
            destinationAccountId: destination,
            amount: body.amount,
            description: body.description,
            referenceId,
            createdAt: postedAt,
          })
          .returning();

        const debit = await this.ledger.applyEntry(
          tx,
          {
            accountId: source,
            type: 'debit',
            amount: body.amount,
            referenceId,
            description: body.description ?? `Transfer to ${destination}`,
            transferId: transfer!.id,
          },
          postedAt,
        );
        const credit = await this.ledger.applyEntry(
          tx,
          {
            accountId: destination,
            type: 'credit',
            amount: body.amount,
            referenceId,
            description: body.description ?? `Transfer from ${source}`,
            transferId: transfer!.id,
          },
          postedAt,
        );
        return toTransferResponse(transfer!, debit, credit);
      });
    } catch (err) {
      if (err instanceof UniqueViolationError) {
        const existing = await this.findBySourceReference(this.db, source, referenceId);
        if (existing)
          throw new DuplicateTransferError(referenceId, await this.load(this.db, existing));
      }
      throw err;
    }
  }

  async get(id: string): Promise<TransferResponse> {
    const [row] = await this.db.select().from(transfers).where(eq(transfers.id, id)).limit(1);
    if (!row) throw new TransferNotFoundError(id);
    return this.load(this.db, row);
  }

  private async findBySourceReference(
    executor: Db | Tx,
    sourceAccountId: string,
    referenceId: string,
  ): Promise<TransferRow | undefined> {
    const [row] = await executor
      .select()
      .from(transfers)
      .where(
        and(eq(transfers.sourceAccountId, sourceAccountId), eq(transfers.referenceId, referenceId)),
      )
      .limit(1);
    return row;
  }

  private async load(executor: Db | Tx, transfer: TransferRow): Promise<TransferResponse> {
    const legs = await executor
      .select()
      .from(transactions)
      .where(eq(transactions.transferId, transfer.id));
    const debit = legs.find((l) => l.type === 'debit');
    const credit = legs.find((l) => l.type === 'credit');
    if (!debit || !credit) throw new Error(`transfer ${transfer.id} is missing a leg`);
    return toTransferResponse(transfer, debit, credit);
  }
}
