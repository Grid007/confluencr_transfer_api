import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount, fundedAccount, transfer } from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

async function sqlState(promise: PromiseLike<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (err) {
    return (err as { code?: string }).code ?? 'UNKNOWN';
  }
}

const RESTRICT = '23001';

describe('immutability enforced by the database', () => {
  let t: TestApp;
  let sql: TestApp['db']['$client'];
  let txId: string;
  let transferId: string;
  let accountId: string;
  beforeAll(async () => {
    t = await createTestApp();
    sql = t.db.$client;
    const a = await fundedAccount(t, 100);
    const b = await createAccount(t);
    const tr = await transfer(t, {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: 5,
    });
    transferId = tr.body.id;
    txId = tr.body.debit_transaction.id;
    accountId = a.id;
  });
  afterAll(async () => {
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  it.each([
    ['amount', 'update transactions set amount = 1 where id = $1'],
    ['type', "update transactions set type = 'credit' where id = $1"],
    ['description', "update transactions set description = 'edited' where id = $1"],
    ['reference_id', "update transactions set reference_id = 'edited' where id = $1"],
    ['account_id', 'update transactions set account_id = account_id where id = $1'],
    ['created_at', "update transactions set created_at = now() - interval '1 day' where id = $1"],
    ['delete', 'delete from transactions where id = $1'],
  ])('transactions: %s cannot be changed', async (_label, statement) => {
    expect(await sqlState(sql.unsafe(statement, [txId]))).toBe(RESTRICT);
  });

  it('transactions cannot be truncated', async () => {
    expect(await sqlState(sql.unsafe('truncate transactions'))).toBe(RESTRICT);
  });

  it.each([
    ['update', 'update transfers set amount = 1 where id = $1'],
    ['delete', 'delete from transfers where id = $1'],
  ])('transfers: %s is rejected', async (_label, statement) => {
    expect(await sqlState(sql.unsafe(statement, [transferId]))).toBe(RESTRICT);
  });

  it('transfers cannot be truncated (trigger, or the FK guard that fires first)', async () => {
    expect(['23001', '0A000']).toContain(await sqlState(sql.unsafe('truncate transfers')));
  });

  it.each([
    ['id', 'update accounts set id = gen_random_uuid() where id = $1'],
    ['name', "update accounts set name = 'renamed' where id = $1"],
    ['created_at', "update accounts set created_at = now() - interval '1 year' where id = $1"],
    ['delete', 'delete from accounts where id = $1'],
  ])('accounts: %s is frozen', async (_label, statement) => {
    expect(await sqlState(sql.unsafe(statement, [accountId]))).toBe(RESTRICT);
  });

  it('accounts cannot be truncated (trigger, or the FK guard that fires first)', async () => {
    expect(['23001', '0A000']).toContain(await sqlState(sql.unsafe('truncate accounts')));
  });

  it('only accounts.balance may change (and the ledger reconciliation still catches a hand edit)', async () => {
    const a = await createAccount(t);
    expect(
      await sqlState(sql.unsafe('update accounts set balance = 5 where id = $1', [a.id])),
    ).toBe('OK');
    await expect(assertLedgerConsistent(t.db)).rejects.toThrow(); // balance 5 with an empty ledger is detected
    await sql.unsafe('update accounts set balance = 0 where id = $1', [a.id]);
    await assertLedgerConsistent(t.db);
  });

  it('the API reports the original, unchanged transaction after every rejected edit', async () => {
    const res = await t.http.get(`/v1/transactions/${txId}`);
    expect(res.body).toMatchObject({
      amount: '5.00',
      type: 'debit',
      account_id: accountId,
      balance_after: '95.00',
    });
  });
});
