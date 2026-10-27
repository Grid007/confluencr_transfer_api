import { z } from 'zod';
import type { TransactionRow } from '../database/schema/transactions.js';
import type { TransferRow } from '../database/schema/transfers.js';

export const transactionResponse = z.object({
  id: z.string().meta({ format: 'uuid' }),
  account_id: z.string().meta({ format: 'uuid' }),
  type: z.enum(['credit', 'debit']),
  amount: z.string().meta({ example: '50.00' }),
  description: z.string().nullable(),
  reference_id: z.string(),
  balance_after: z
    .string()
    .meta({ description: 'Account balance immediately after this transaction' }),
  transfer_id: z.string().nullable().meta({ format: 'uuid' }),
  created_at: z.string().meta({ format: 'date-time' }),
});
export type TransactionResponse = z.infer<typeof transactionResponse>;

export const transferResponse = z.object({
  id: z.string().meta({ format: 'uuid' }),
  source_account_id: z.string().meta({ format: 'uuid' }),
  destination_account_id: z.string().meta({ format: 'uuid' }),
  amount: z.string(),
  description: z.string().nullable(),
  reference_id: z.string(),
  created_at: z.string().meta({ format: 'date-time' }),
  debit_transaction: transactionResponse,
  credit_transaction: transactionResponse,
});
export type TransferResponse = z.infer<typeof transferResponse>;

export const toTransactionResponse = (row: TransactionRow): TransactionResponse => ({
  id: row.id,
  account_id: row.accountId,
  type: row.type,
  amount: row.amount,
  description: row.description,
  reference_id: row.referenceId,
  balance_after: row.balanceAfter,
  transfer_id: row.transferId,
  created_at: row.createdAt.toISOString(),
});

export const toTransferResponse = (
  row: TransferRow,
  debit: TransactionRow,
  credit: TransactionRow,
): TransferResponse => ({
  id: row.id,
  source_account_id: row.sourceAccountId,
  destination_account_id: row.destinationAccountId,
  amount: row.amount,
  description: row.description,
  reference_id: row.referenceId,
  created_at: row.createdAt.toISOString(),
  debit_transaction: toTransactionResponse(debit),
  credit_transaction: toTransactionResponse(credit),
});
