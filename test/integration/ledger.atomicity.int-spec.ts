import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, fundedAccount, postTx, transfer } from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { installFailureTrigger, removeFailureTrigger } from '../helpers/fault.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

async function countRows(t: TestApp, table: 'transactions' | 'transfers', accountId?: string) {
  const rows = accountId
    ? await t.db.$client.unsafe(
        `select count(*)::int as n from ${table} where ${table === 'transactions' ? 'account_id' : 'source_account_id'} = $1`,
        [accountId],
      )
    : await t.db.$client.unsafe(`select count(*)::int as n from ${table}`);
  return rows[0]!.n as number;
}

describe('atomicity (fault injection)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await installFailureTrigger(t.db);
  });
  afterAll(async () => {
    await removeFailureTrigger(t.db);
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  it('a failure after the balance UPDATE leaves neither the new balance nor a ledger row', async () => {
    const a = await fundedAccount(t, 100);
    const before = await countRows(t, 'transactions', a.id);

    const res = await postTx(t, {
      account_id: a.id,
      type: 'credit',
      amount: 50,
      description: '__FAIL__',
    });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('injected failure'); // no internals leak to the client
    expect(await balanceOf(t, a.id)).toBe('100.00');
    expect(await countRows(t, 'transactions', a.id)).toBe(before);
  });

  it('a failed transfer leg rolls back the debit leg, the transfer row and both balances', async () => {
    const [a, b] = await Promise.all([fundedAccount(t, 100), fundedAccount(t, 50)]);
    const transfersBefore = await countRows(t, 'transfers');
    const legsBefore =
      (await countRows(t, 'transactions', a.id)) + (await countRows(t, 'transactions', b.id));

    // The credit leg (second write) fails after the debit leg and the transfer row were written.
    const res = await transfer(t, {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: 30,
      description: '__FAIL__',
    });

    expect(res.status).toBe(500);
    expect(await balanceOf(t, a.id)).toBe('100.00');
    expect(await balanceOf(t, b.id)).toBe('50.00');
    expect(await countRows(t, 'transfers')).toBe(transfersBefore);
    expect(
      (await countRows(t, 'transactions', a.id)) + (await countRows(t, 'transactions', b.id)),
    ).toBe(legsBefore);
  });

  it('the account is fully usable after a rolled-back failure', async () => {
    const a = await fundedAccount(t, 10);
    await postTx(t, { account_id: a.id, type: 'credit', amount: 5, description: '__FAIL__' });
    const ok = await postTx(t, { account_id: a.id, type: 'credit', amount: 5 });
    expect(ok.status).toBe(201);
    expect(await balanceOf(t, a.id)).toBe('15.00');
  });
});
