import { randomUUID } from 'node:crypto';
import type { TestApp } from './test-app.js';

export const ref = (prefix = 'ref'): string => `${prefix}-${randomUUID()}`;

export interface TxBody {
  account_id: string;
  type: 'credit' | 'debit';
  amount: number | string;
  reference_id?: string;
  description?: string | null;
}

export async function createAccount(t: TestApp, name = 'Test Account') {
  const res = await t.http.post('/v1/accounts').send({ name });
  if (res.status !== 201) throw new Error(`createAccount failed: ${res.status} ${res.text}`);
  return res.body as { id: string; name: string; balance: string; created_at: string };
}

export const postTx = (t: TestApp, body: TxBody) =>
  t.http.post('/v1/transactions').send({ reference_id: ref(), ...body });

/** Creates an account holding `amount`. */
export async function fundedAccount(t: TestApp, amount: number | string, name?: string) {
  const account = await createAccount(t, name);
  if (Number(amount) > 0) {
    const res = await postTx(t, { account_id: account.id, type: 'credit', amount });
    if (res.status !== 201) throw new Error(`funding failed: ${res.status} ${res.text}`);
  }
  return account;
}

export async function balanceOf(t: TestApp, accountId: string): Promise<string> {
  const res = await t.http.get(`/v1/accounts/${accountId}/balance`);
  return (res.body as { balance: string }).balance;
}

export const transfer = (
  t: TestApp,
  body: {
    source_account_id: string;
    destination_account_id: string;
    amount: number | string;
    reference_id?: string;
    description?: string | null;
  },
) => t.http.post('/v1/transfers').send(body);

export const tally = (statuses: number[]): Record<number, number> =>
  statuses.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
