import { z } from 'zod';
import {
  amountField,
  descriptionField,
  referenceIdField,
  transactionTypeField,
  uuidField,
} from '../common/validation/fields.js';

export const createTransactionBody = z.strictObject({
  account_id: uuidField,
  type: transactionTypeField,
  amount: amountField,
  reference_id: referenceIdField,
  description: descriptionField,
});
export type CreateTransactionBody = z.infer<typeof createTransactionBody>;

export const transactionIdParams = z.strictObject({ transaction_id: uuidField });
export type TransactionIdParams = z.infer<typeof transactionIdParams>;
