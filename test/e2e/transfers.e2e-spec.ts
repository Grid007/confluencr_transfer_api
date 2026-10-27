import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, createAccount, fundedAccount, transfer } from '../helpers/api.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('transfers (HTTP contract)', () => {
  let t: TestApp;
  let a: { id: string };
  let b: { id: string };
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  const fresh = async () => {
    a = await fundedAccount(t, 100);
    b = await createAccount(t);
  };
  const send = (over: Record<string, unknown> = {}) =>
    t.http
      .post('/v1/transfers')
      .send({ source_account_id: a.id, destination_account_id: b.id, amount: 10, ...over });

  it('returns the transfer with both legs and a Location header', async () => {
    await fresh();
    const res = await send({ description: 'Rent', reference_id: 'rent-oct' });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/v1/transfers/${res.body.id}`);
    expect(res.body).toMatchObject({
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: '10.00',
      description: 'Rent',
      reference_id: 'rent-oct',
    });
    expect(res.body.debit_transaction.description).toBe('Rent');
    expect(res.body.credit_transaction.description).toBe('Rent');
  });

  it('rejects transferring to the same account with SAME_ACCOUNT', async () => {
    await fresh();
    const res = await send({ destination_account_id: a.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({
      field: 'destination_account_id',
      rule: 'SAME_ACCOUNT',
    });
    expect(await balanceOf(t, a.id)).toBe('100.00');
  });

  it.each([
    ['source_account_id', undefined, 'REQUIRED'],
    ['destination_account_id', undefined, 'REQUIRED'],
    ['source_account_id', 'nope', 'INVALID_UUID'],
    ['destination_account_id', 'nope', 'INVALID_UUID'],
    ['amount', 0, 'INVALID_AMOUNT'],
    ['amount', -1, 'INVALID_AMOUNT'],
    ['amount', '1.234', 'INVALID_AMOUNT'],
    ['amount', 'abc', 'INVALID_AMOUNT'],
    ['amount', undefined, 'REQUIRED'],
    ['reference_id', '', 'BLANK'],
    ['reference_id', ' x', 'INVALID_FORMAT'],
  ])('validates %s = %j -> %s', async (field, value, rule) => {
    await fresh();
    const body: Record<string, unknown> = {
      source_account_id: a.id,
      destination_account_id: b.id,
      amount: 10,
    };
    if (value === undefined) delete body[field];
    else body[field] = value;
    const res = await t.http.post('/v1/transfers').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ field, rule });
  });

  it.each(['id', 'created_at', 'fee', 'transfer_id'])(
    'rejects an unknown or server-owned field: %s',
    async (key) => {
      await fresh();
      const res = await send({ [key]: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0]).toMatchObject({ field: key, rule: 'UNKNOWN_FIELD' });
    },
  );

  it.each([
    ['source', 'source_account_id'],
    ['destination', 'destination_account_id'],
  ])('a missing %s account is a 404 naming the field', async (_label, field) => {
    await fresh();
    const res = await send({ [field]: '00000000-0000-4000-8000-0000000000aa' });
    expect(res.status).toBe(404);
    expect(res.body.error.context.missing).toEqual([
      { field, account_id: '00000000-0000-4000-8000-0000000000aa' },
    ]);
    expect(await balanceOf(t, a.id)).toBe('100.00');
  });

  it('GET /transfers/:id returns the same body; 404 and 400 otherwise', async () => {
    await fresh();
    const created = await send();
    const fetched = await t.http.get(`/v1/transfers/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
    const missing = await t.http.get('/v1/transfers/00000000-0000-4000-8000-000000000000');
    expect([missing.status, missing.body.error.code]).toEqual([404, 'TRANSFER_NOT_FOUND']);
    expect((await t.http.get('/v1/transfers/nope')).status).toBe(400);
  });

  it.each(['put', 'patch', 'delete'] as const)(
    'does not allow %s on a transfer',
    async (method) => {
      await fresh();
      const created = await send();
      const res = await t.http[method](`/v1/transfers/${created.body.id}`).send({});
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
    },
  );

  it('GET /transfers is 405 with Allow: POST', async () => {
    const res = await t.http.get('/v1/transfers');
    expect([res.status, res.headers.allow]).toEqual([405, 'POST']);
  });

  it('exact decimals survive a transfer', async () => {
    const x = await fundedAccount(t, '0.30');
    const y = await createAccount(t);
    const res = await transfer(t, {
      source_account_id: x.id,
      destination_account_id: y.id,
      amount: '0.10',
    });
    expect(res.status).toBe(201);
    await transfer(t, { source_account_id: x.id, destination_account_id: y.id, amount: '0.20' });
    expect(await balanceOf(t, x.id)).toBe('0.00');
    expect(await balanceOf(t, y.id)).toBe('0.30');
  });
});
