import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, createAccount, fundedAccount, postTx, ref, tally } from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('ledger concurrency', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  it('25 parallel debits of 10.00 against 100.00: exactly 10 succeed, never negative', async () => {
    const a = await fundedAccount(t, 100);
    const results = await Promise.all(
      Array.from({ length: 25 }, () => postTx(t, { account_id: a.id, type: 'debit', amount: 10 })),
    );
    expect(tally(results.map((r) => r.status))).toEqual({ 201: 10, 422: 15 });
    expect(results.filter((r) => r.status === 500)).toHaveLength(0);
    expect(await balanceOf(t, a.id)).toBe('0.00');

    const history = await t.http.get(`/v1/accounts/${a.id}/transactions?type=debit&limit=100`);
    expect(history.body.meta.total_records).toBe(10);
  });

  it('10 parallel debits of 30.00 against 100.00: exactly 3 succeed, 10.00 left', async () => {
    const a = await fundedAccount(t, 100);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => postTx(t, { account_id: a.id, type: 'debit', amount: 30 })),
    );
    expect(tally(results.map((r) => r.status))).toEqual({ 201: 3, 422: 7 });
    expect(await balanceOf(t, a.id)).toBe('10.00');
  });

  it('50 parallel credits of 1.00: no lost update, balance_after is a permutation of 1..50', async () => {
    const a = await createAccount(t);
    const results = await Promise.all(
      Array.from({ length: 50 }, () => postTx(t, { account_id: a.id, type: 'credit', amount: 1 })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(t, a.id)).toBe('50.00');
    const after = results.map((r) => Number(r.body.balance_after)).sort((x, y) => x - y);
    expect(after).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('mixed parallel credits and debits conserve money exactly', async () => {
    const a = await fundedAccount(t, 500);
    const ops = Array.from({ length: 40 }, (_, i) =>
      postTx(t, { account_id: a.id, type: i % 2 === 0 ? 'credit' : 'debit', amount: '12.34' }),
    );
    const results = await Promise.all(ops);
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(t, a.id)).toBe('500.00'); // 20 credits and 20 debits of 12.34 cancel out
  });

  it('parallel debits on different accounts do not interfere', async () => {
    const accounts = await Promise.all(Array.from({ length: 5 }, () => fundedAccount(t, 50)));
    const results = await Promise.all(
      accounts.flatMap((a) =>
        Array.from({ length: 6 }, () => postTx(t, { account_id: a.id, type: 'debit', amount: 10 })),
      ),
    );
    expect(tally(results.map((r) => r.status))).toEqual({ 201: 25, 422: 5 });
    for (const a of accounts) expect(await balanceOf(t, a.id)).toBe('0.00');
  });

  it('every parallel request used a distinct reference (sanity for the suite itself)', () => {
    expect(ref()).not.toBe(ref());
  });
});
