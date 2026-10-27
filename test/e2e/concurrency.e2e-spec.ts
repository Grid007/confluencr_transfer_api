import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, createAccount, fundedAccount, postTx, tally } from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

/** The same guarantees as the integration suite, proven through the real HTTP stack. */
describe('concurrency over HTTP', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  it('20 parallel POST debits of 10.00 on a balance of 100.00: exactly 10 x 201 and 10 x 422', async () => {
    const a = await fundedAccount(t, 100);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => postTx(t, { account_id: a.id, type: 'debit', amount: 10 })),
    );
    expect(tally(results.map((r) => r.status))).toEqual({ 201: 10, 422: 10 });
    expect(await balanceOf(t, a.id)).toBe('0.00');
  });

  it('10 parallel identical POSTs: one 201 and nine 409s that all point at the same transaction', async () => {
    const a = await createAccount(t);
    const body = { account_id: a.id, type: 'credit' as const, amount: 5, reference_id: 'same-key' };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => t.http.post('/v1/transactions').send(body)),
    );
    expect(tally(results.map((r) => r.status))).toEqual({ 201: 1, 409: 9 });
    const winnerId = results.find((r) => r.status === 201)!.body.id;
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.context.existing_transaction.id).toBe(winnerId);
    }
    expect(await balanceOf(t, a.id)).toBe('5.00');
  });
});
