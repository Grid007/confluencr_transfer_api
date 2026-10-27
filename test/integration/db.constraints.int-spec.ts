import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, createAccount, fundedAccount, postTx } from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

/** SQLSTATE of the failure, or 'OK' when the statement succeeded. */
async function sqlState(promise: PromiseLike<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (err) {
    return (err as { code?: string }).code ?? 'UNKNOWN';
  }
}

describe('database constraints (raw SQL, bypassing the API)', () => {
  let t: TestApp;
  let sql: TestApp['db']['$client'];
  beforeAll(async () => {
    t = await createTestApp();
    sql = t.db.$client;
  });
  afterAll(async () => {
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  const insertTx = (over: Record<string, unknown> = {}) => {
    const v = {
      account_id: '',
      type: 'credit',
      amount: '1.00',
      reference_id: `raw-${Math.random()}`,
      balance_after: '1.00',
      ...over,
    };
    return sql.unsafe(
      `insert into transactions (account_id, type, amount, reference_id, balance_after, created_at)
       values ($1, $2::transaction_type, $3, $4, $5, now())`,
      [v.account_id, v.type, v.amount, v.reference_id, v.balance_after] as never[],
    );
  };

  it('accounts must start at a zero balance, even for direct inserts', async () => {
    expect(
      await sqlState(sql.unsafe("insert into accounts (name, balance) values ('rich', 500)")),
    ).toBe('23001');
    expect(await sqlState(sql.unsafe("insert into accounts (name) values ('ok')"))).toBe('OK');
  });

  it('a negative balance violates CHECK (balance >= 0)', async () => {
    const a = await createAccount(t);
    expect(
      await sqlState(sql.unsafe('update accounts set balance = -1 where id = $1', [a.id])),
    ).toBe('23514');
  });

  it('account name must be 1..100 characters', async () => {
    expect(await sqlState(sql.unsafe("insert into accounts (name) values ('')"))).toBe('23514');
    expect(
      await sqlState(sql.unsafe('insert into accounts (name) values ($1)', ['x'.repeat(101)])),
    ).toBe('23514');
  });

  it('(account_id, reference_id) is unique', async () => {
    const a = await createAccount(t);
    expect(await sqlState(insertTx({ account_id: a.id, reference_id: 'dup' }))).toBe('OK');
    expect(await sqlState(insertTx({ account_id: a.id, reference_id: 'dup' }))).toBe('23505');
    // clean up reconciliation: the raw rows above bypassed the balance update
    await sql.unsafe('update accounts set balance = 1 where id = $1', [a.id]);
  });

  it('amount must be positive, balance_after non-negative, type a valid enum, account must exist', async () => {
    const a = await createAccount(t);
    expect(await sqlState(insertTx({ account_id: a.id, amount: '0' }))).toBe('23514');
    expect(await sqlState(insertTx({ account_id: a.id, amount: '-1' }))).toBe('23514');
    expect(await sqlState(insertTx({ account_id: a.id, balance_after: '-1' }))).toBe('23514');
    expect(await sqlState(insertTx({ account_id: a.id, type: 'foo' }))).toBe('22P02');
    expect(await sqlState(insertTx({ account_id: '00000000-0000-4000-8000-00000000dead' }))).toBe(
      '23503',
    );
    expect(await sqlState(insertTx({ account_id: a.id, reference_id: '' }))).toBe('23514');
  });

  it('a transfer between the same account is rejected by CHECK', async () => {
    const a = await createAccount(t);
    expect(
      await sqlState(
        sql.unsafe(
          `insert into transfers (source_account_id, destination_account_id, amount, reference_id, created_at)
           values ($1, $1, 1, 'x', now())`,
          [a.id],
        ),
      ),
    ).toBe('23514');
  });

  it('two debit legs (or two credit legs) cannot belong to one transfer', async () => {
    const a = await fundedAccount(t, 10);
    const b = await createAccount(t);
    const res = await t.http
      .post('/v1/transfers')
      .send({ source_account_id: a.id, destination_account_id: b.id, amount: 1 });
    expect(
      await sqlState(
        sql.unsafe(
          `insert into transactions (account_id, type, amount, reference_id, balance_after, transfer_id, created_at)
           values ($1, 'debit', 1, 'extra-leg', 0, $2, now())`,
          [a.id, res.body.id],
        ),
      ),
    ).toBe('23505');
  });

  it('a credit that would overflow numeric(19,2) is a clean 422 BALANCE_LIMIT_EXCEEDED, not a 500', async () => {
    const a = await createAccount(t);
    await sql.unsafe('update accounts set balance = 99999999999999999.00 where id = $1', [a.id]);
    try {
      const res = await postTx(t, { account_id: a.id, type: 'credit', amount: '1000' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BALANCE_LIMIT_EXCEEDED');
      expect(await balanceOf(t, a.id)).toBe('99999999999999999.00');
    } finally {
      await sql.unsafe('update accounts set balance = 0 where id = $1', [a.id]); // no ledger rows exist for it
    }
  });
});
