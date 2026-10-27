import { z } from 'zod';
import {
  amountField,
  descriptionField,
  referenceIdField,
  uuidField,
} from '../common/validation/fields.js';

export const createTransferBody = z
  .strictObject({
    source_account_id: uuidField,
    destination_account_id: uuidField,
    amount: amountField,
    // Optional: the server generates one so every transfer is addressable and de-duplicable.
    reference_id: referenceIdField.optional(),
    description: descriptionField,
  })
  .refine((b) => b.source_account_id !== b.destination_account_id, {
    path: ['destination_account_id'],
    message: 'destination_account_id must differ from source_account_id',
    params: { rule: 'SAME_ACCOUNT' },
  });
export type CreateTransferBody = z.infer<typeof createTransferBody>;

export const transferIdParams = z.strictObject({ transfer_id: uuidField });
export type TransferIdParams = z.infer<typeof transferIdParams>;
