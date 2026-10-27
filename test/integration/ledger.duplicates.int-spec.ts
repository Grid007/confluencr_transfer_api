import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { balanceOf, createAccount, fundedAccount, postTx, ref, tally } from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('duplicate reference_id handling', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  it('10 identical parallel submissions: exactly one row, nine 409s pointing at the same transaction', async () => {
    const a = await createAccount(t);
    const reference = ref();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        postTx(t, { account_id: a.id, type: 'credit', amount: 5, reference_id: reference }),
      ),
    );
    expect(tally(results.map((r) => r.status))).toEqual({ 201: 1, 409: 9 });
    const winner = results.find((r) => r.status === 201)!;
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('DUPLICATE_TRANSACTION');
      expect(r.body.error.context.existing_transaction.id).toBe(winner.body.id);
    }
    expect(await balanceOf(t, a.id)).toBe('5.00');
    const history = await t.http.get(`/v1/accounts/${a.id}/transactions`);
    expect(history.body.meta.total_records).toBe(1);
  });

  it('parallel submissions with different amounts: the winner applies, the rest change nothing', async () => {
    const a = await createAccount(t);
    const reference = ref();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((amount) =>
        postTx(t, { account_id: a.id, type: 'credit', amount, reference_id: reference }),
      ),
    );
    expect(tally(results.map((r) => r.status))).toEqual({ 201: 1, 409: 4 });
    const winner = results.find((r) => r.status === 201)!;
    expect(await balanceOf(t, a.id)).toBe(winner.body.amount);
  });

  it('a replayed debit is a 409 even when the balance has since dropped below it (never a 422)', async () => {
    const a = await fundedAccount(t, 100);
    const reference = ref();
    const first = await postTx(t, {
      account_id: a.id,
      type: 'debit',
      amount: 100,
      reference_id: reference,
    });
    expect(first.status).toBe(201);
    const replay = await postTx(t, {
      account_id: a.id,
      type: 'debit',
      amount: 100,
      reference_id: reference,
    });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(await balanceOf(t, a.id)).toBe('0.00');
  });

  it('the same reference_id is allowed on different accounts', async () => {
    const [a, b] = await Promise.all([createAccount(t), createAccount(t)]);
    const reference = ref();
    const results = await Promise.all(
      [a, b].map((acc) =>
        postTx(t, { account_id: acc.id, type: 'credit', amount: 7, reference_id: reference }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
  });

  it('reference_id is case-sensitive', async () => {
    const a = await createAccount(t);
    const one = await postTx(t, {
      account_id: a.id,
      type: 'credit',
      amount: 1,
      reference_id: 'REF-1',
    });
    const two = await postTx(t, {
      account_id: a.id,
      type: 'credit',
      amount: 1,
      reference_id: 'ref-1',
    });
    expect([one.status, two.status]).toEqual([201, 201]);
  });

  it('a duplicate on a missing account is a 404, not a 409', async () => {
    const res = await postTx(t, {
      account_id: '00000000-0000-4000-8000-000000000000',
      type: 'credit',
      amount: 1,
      reference_id: 'anything',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('UNIQUE-constraint backstop: if the duplicate check were bypassed, the API still answers 409 with the existing row', async () => {
    const a = await createAccount(t);
    const reference = ref();
    const first = await postTx(t, {
      account_id: a.id,
      type: 'credit',
      amount: 9,
      reference_id: reference,
    });
    expect(first.status).toBe(201);

    const ledger = t.app.get(LedgerService);
    const spy = vi.spyOn(ledger, 'assertNoDuplicate').mockResolvedValue(undefined);
    try {
      const second = await postTx(t, {
        account_id: a.id,
        type: 'credit',
        amount: 9,
        reference_id: reference,
      });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('DUPLICATE_TRANSACTION');
      expect(second.body.error.context.existing_transaction.id).toBe(first.body.id);
    } finally {
      spy.mockRestore();
    }
    expect(await balanceOf(t, a.id)).toBe('9.00'); // the failed insert rolled the balance update back
  });
});
