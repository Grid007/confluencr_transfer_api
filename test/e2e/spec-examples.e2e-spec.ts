import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, createAccount, fundedAccount, postTx, ref, transfer } from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

/** The worked examples from the assessment brief, verbatim, over HTTP. */
describe('assessment brief: worked examples', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  it('credit: balance 100 + credit 50 = 150', async () => {
    const a = await fundedAccount(t, 100);
    const res = await postTx(t, { account_id: a.id, type: 'credit', amount: 50 });
    expect(res.status).toBe(201);
    expect(await balanceOf(t, a.id)).toBe('150.00');
  });

  it('debit: balance 100 - debit 30 = 70', async () => {
    const a = await fundedAccount(t, 100);
    const res = await postTx(t, { account_id: a.id, type: 'debit', amount: 30 });
    expect(res.status).toBe(201);
    expect(await balanceOf(t, a.id)).toBe('70.00');
  });

  it('insufficient balance: debit 150 on 100 is rejected and the balance remains 100', async () => {
    const a = await fundedAccount(t, 100);
    const res = await postTx(t, { account_id: a.id, type: 'debit', amount: 150 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balanceOf(t, a.id)).toBe('100.00');
  });

  it('balance consistency: 0 +100 +50 -30 -20 = 100 with a balance_after chain of 100/150/120/100', async () => {
    const a = await createAccount(t);
    const steps: Array<['credit' | 'debit', number]> = [
      ['credit', 100],
      ['credit', 50],
      ['debit', 30],
      ['debit', 20],
    ];
    const after: string[] = [];
    for (const [type, amount] of steps) {
      const res = await postTx(t, { account_id: a.id, type, amount });
      expect(res.status).toBe(201);
      after.push(res.body.balance_after);
    }
    expect(after).toEqual(['100.00', '150.00', '120.00', '100.00']);
    expect(await balanceOf(t, a.id)).toBe('100.00');
  });

  it('a rejected transaction does not affect the balance or the history', async () => {
    const a = await fundedAccount(t, 100);
    await postTx(t, { account_id: a.id, type: 'debit', amount: 150 });
    const history = await t.http.get(`/v1/accounts/${a.id}/transactions`);
    expect(history.body.meta.total_records).toBe(1);
    expect(await balanceOf(t, a.id)).toBe('100.00');
  });

  it('duplicate: no new transaction, balance unchanged, 409 says it already exists', async () => {
    const a = await fundedAccount(t, 100);
    const reference = ref();
    const first = await postTx(t, {
      account_id: a.id,
      type: 'credit',
      amount: 50,
      reference_id: reference,
    });
    const again = await postTx(t, {
      account_id: a.id,
      type: 'credit',
      amount: 50,
      reference_id: reference,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain('already exists');
    expect(again.body.error.context.existing_transaction).toEqual(first.body);
    expect(await balanceOf(t, a.id)).toBe('150.00');
    const history = await t.http.get(`/v1/accounts/${a.id}/transactions`);
    expect(history.body.meta.total_records).toBe(2); // the funding credit and the first 50
  });

  it('the same reference_id may be used for different accounts', async () => {
    const [a, b] = await Promise.all([createAccount(t), createAccount(t)]);
    const reference = ref();
    expect(
      (await postTx(t, { account_id: a.id, type: 'credit', amount: 1, reference_id: reference }))
        .status,
    ).toBe(201);
    expect(
      (await postTx(t, { account_id: b.id, type: 'credit', amount: 1, reference_id: reference }))
        .status,
    ).toBe(201);
  });

  it('transfer: A=100, B=50, transfer 30 -> A=70, B=80', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), fundedAccount(t, 50)]);
    const res = await transfer(t, {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: 30,
    });
    expect(res.status).toBe(201);
    expect(await balanceOf(t, a.id)).toBe('70.00');
    expect(await balanceOf(t, b.id)).toBe('80.00');
  });

  it('transaction rows never change once created, whatever happens afterwards', async () => {
    const a = await fundedAccount(t, 100);
    const created = await postTx(t, { account_id: a.id, type: 'debit', amount: 10 });
    await postTx(t, { account_id: a.id, type: 'credit', amount: 999 });
    for (const method of ['put', 'patch', 'delete'] as const) {
      expect(
        (await t.http[method](`/v1/transactions/${created.body.id}`).send({ amount: 1 })).status,
      ).toBe(405);
    }
    const fetched = await t.http.get(`/v1/transactions/${created.body.id}`);
    expect(fetched.body).toEqual(created.body);
  });
});
