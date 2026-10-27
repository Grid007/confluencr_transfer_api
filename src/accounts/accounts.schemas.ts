import { z } from 'zod';
import { limitField, pageField } from '../common/pagination/pagination.schema.js';
import { nameField, transactionTypeField, uuidField } from '../common/validation/fields.js';

export const createAccountBody = z.strictObject({ name: nameField });
export type CreateAccountBody = z.infer<typeof createAccountBody>;

export const accountIdParams = z.strictObject({ account_id: uuidField });
export type AccountIdParams = z.infer<typeof accountIdParams>;

export const historyQuery = z.strictObject({
  type: transactionTypeField.optional(),
  page: pageField,
  limit: limitField,
});
export type HistoryQuery = z.infer<typeof historyQuery>;

export const accountResponse = z.object({
  id: z.string().meta({ format: 'uuid' }),
  name: z.string(),
  balance: z.string().meta({ example: '0.00' }),
  created_at: z.string().meta({ format: 'date-time' }),
});
export type AccountResponse = z.infer<typeof accountResponse>;

export const balanceResponse = z.object({
  account_id: z.string().meta({ format: 'uuid' }),
  balance: z.string().meta({ example: '100.00' }),
});
export type BalanceResponse = z.infer<typeof balanceResponse>;
