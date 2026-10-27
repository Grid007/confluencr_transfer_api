import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  balanceOf,
  createAccount,
  fundedAccount,
  postTx,
  ref,
  tally,
  transfer,
} from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('transfers', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  it('A=100, B=50, transfer 30 -> A=70, B=80 with two linked legs and one transfer row', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), fundedAccount(t, 50)]);
    const reference = ref('tr');
    const res = await transfer(t, {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: 30,
      reference_id: reference,
    });

    expect(res.status).toBe(201);
    expect(await balanceOf(t, a.id)).toBe('70.00');
    expect(await balanceOf(t, b.id)).toBe('80.00');

    const { debit_transaction: debit, credit_transaction: credit } = res.body;
    expect(debit).toMatchObject({
      account_id: a.id,
      type: 'debit',
      amount: '30.00',
      balance_after: '70.00',
    });
    expect(credit).toMatchObject({
      account_id: b.id,
      type: 'credit',
      amount: '30.00',
      balance_after: '80.00',
    });
    expect(debit.transfer_id).toBe(res.body.id);
    expect(credit.transfer_id).toBe(res.body.id);
    expect(debit.reference_id).toBe(reference);
    expect(credit.reference_id).toBe(reference);
    expect(debit.created_at).toBe(credit.created_at);
    expect(res.body.created_at).toBe(debit.created_at);

    const rows = await t.db.$client.unsafe(
      'select count(*)::int as n from transfers where id = $1',
      [res.body.id],
    );
    expect(rows[0]!.n).toBe(1);

    const fetched = await t.http.get(`/v1/transfers/${res.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(res.body);
  });

  it('legs show up in each account history as ordinary debit/credit rows', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), createAccount(t)]);
    const res = await transfer(t, {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: '12.50',
    });
    const aDebits = await t.http.get(`/v1/accounts/${a.id}/transactions?type=debit`);
    const bCredits = await t.http.get(`/v1/accounts/${b.id}/transactions?type=credit`);
    expect(aDebits.body.data[0].transfer_id).toBe(res.body.id);
    expect(bCredits.body.data[0].transfer_id).toBe(res.body.id);
    expect(aDebits.body.data[0].description).toBe(`Transfer to ${b.id}`);
    expect(bCredits.body.data[0].description).toBe(`Transfer from ${a.id}`);
  });

  it('transferring the whole balance leaves 0.00', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), createAccount(t)]);
    expect(
      (await transfer(t, { source_account_id: a.id, destination_account_id: b.id, amount: 100 }))
        .status,
    ).toBe(201);
    expect(await balanceOf(t, a.id)).toBe('0.00');
    expect(await balanceOf(t, b.id)).toBe('100.00');
  });

  it('insufficient balance: 422, both balances untouched, nothing persisted', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), fundedAccount(t, 50)]);
    const res = await transfer(t, {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: '100.01',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(res.body.error.context).toMatchObject({ account_id: a.id, shortfall: '0.01' });
    expect(await balanceOf(t, a.id)).toBe('100.00');
    expect(await balanceOf(t, b.id)).toBe('50.00');
  });

  it('the same transfer reference twice: 409 DUPLICATE_TRANSFER with the existing transfer, balances unchanged', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), createAccount(t)]);
    const body = {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: 10,
      reference_id: ref('tr'),
    };
    const first = await transfer(t, body);
    const replay = await transfer(t, body);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('DUPLICATE_TRANSFER');
    expect(replay.body.error.context.existing_transfer.id).toBe(first.body.id);
    expect(await balanceOf(t, a.id)).toBe('90.00');
    expect(await balanceOf(t, b.id)).toBe('10.00');
  });

  it('a replayed transfer is a 409 even if the source can no longer afford it (409 before 422)', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), createAccount(t)]);
    const body = {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: 100,
      reference_id: ref('tr'),
    };
    expect((await transfer(t, body)).status).toBe(201);
    const replay = await transfer(t, body);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('DUPLICATE_TRANSFER');
  });

  it.each(['source', 'destination'] as const)(
    'a reference already used by a plain transaction on the %s account is a 409 and persists nothing',
    async (which) => {
      const [a, b] = await Promise.all([fundedAccount(t, 100), fundedAccount(t, 100)]);
      const reference = ref('shared');
      const used = which === 'source' ? a : b;
      expect(
        (
          await postTx(t, {
            account_id: used.id,
            type: 'credit',
            amount: 1,
            reference_id: reference,
          })
        ).status,
      ).toBe(201);
      const before = [await balanceOf(t, a.id), await balanceOf(t, b.id)];

      const res = await transfer(t, {
        source_account_id: a.id,
        destination_account_id: b.id,
        amount: 10,
        reference_id: reference,
      });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_TRANSACTION');
      expect([await balanceOf(t, a.id), await balanceOf(t, b.id)]).toEqual(before);
    },
  );

  it('an omitted reference_id is generated and carried by the transfer and both legs', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 10), createAccount(t)]);
    const res = await transfer(t, {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: 1,
    });
    expect(res.body.reference_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.debit_transaction.reference_id).toBe(res.body.reference_id);
    expect(res.body.credit_transaction.reference_id).toBe(res.body.reference_id);
  });

  it('missing accounts: 404 listing every missing field in one response', async () => {
    const ghost = '00000000-0000-4000-8000-000000000001';
    const ghost2 = '00000000-0000-4000-8000-000000000002';
    const res = await transfer(t, {
      source_account_id: ghost,
      destination_account_id: ghost2,
      amount: 5,
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(res.body.error.context.missing.map((m: { field: string }) => m.field).sort()).toEqual([
      'destination_account_id',
      'source_account_id',
    ]);
  });

  it('404 takes precedence over 422 (unknown destination and insufficient funds)', async () => {
    const a = await fundedAccount(t, 1);
    const res = await transfer(t, {
      source_account_id: a.id,
      destination_account_id: '00000000-0000-4000-8000-000000000003',
      amount: 500,
    });
    expect(res.status).toBe(404);
  });

  it('20 transfers A->B racing 20 transfers B->A: no deadlock, no 500, money conserved', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 1000), fundedAccount(t, 1000)]);
    const results = await Promise.all([
      ...Array.from({ length: 20 }, () =>
        transfer(t, { source_account_id: a.id, destination_account_id: b.id, amount: 10 }),
      ),
      ...Array.from({ length: 20 }, () =>
        transfer(t, { source_account_id: b.id, destination_account_id: a.id, amount: 10 }),
      ),
    ]);
    expect(tally(results.map((r) => r.status))).toEqual({ 201: 40 });
    expect(await balanceOf(t, a.id)).toBe('1000.00');
    expect(await balanceOf(t, b.id)).toBe('1000.00');
  });

  it('contended transfers with tight balances only ever end in success or insufficient balance', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), fundedAccount(t, 100)]);
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        transfer(t, { source_account_id: a.id, destination_account_id: b.id, amount: 30 }),
      ),
      ...Array.from({ length: 10 }, () =>
        transfer(t, { source_account_id: b.id, destination_account_id: a.id, amount: 30 }),
      ),
    ]);
    for (const r of results) expect([201, 422]).toContain(r.status);
    const total = Number(await balanceOf(t, a.id)) + Number(await balanceOf(t, b.id));
    expect(total).toBe(200);
    expect(Number(await balanceOf(t, a.id))).toBeGreaterThanOrEqual(0);
    expect(Number(await balanceOf(t, b.id))).toBeGreaterThanOrEqual(0);
  });

  it('a transfer racing a debit that would overdraw the same account: exactly one wins', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), createAccount(t)]);
    const [tr, debit] = await Promise.all([
      transfer(t, { source_account_id: a.id, destination_account_id: b.id, amount: 100 }),
      postTx(t, { account_id: a.id, type: 'debit', amount: 100 }),
    ]);
    expect([tr.status, debit.status].sort()).toEqual([201, 422]);
    expect(await balanceOf(t, a.id)).toBe('0.00');
  });
});
