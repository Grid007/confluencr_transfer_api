import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount, postTx } from '../helpers/api.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('accounts', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('creates an account with a zero balance, a server id and a server timestamp', async () => {
    const before = Date.now();
    const res = await t.http.post('/v1/accounts').send({ name: 'Alice' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(UUID),
      name: 'Alice',
      balance: '0.00',
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(Object.keys(res.body).sort()).toEqual(['balance', 'created_at', 'id', 'name']);
    expect(Math.abs(Date.parse(res.body.created_at) - before)).toBeLessThan(5000);
    expect(res.headers.location).toBe(`/v1/accounts/${res.body.id}`);
  });

  it('gives every account a distinct id and allows duplicate names', async () => {
    const [a, b] = await Promise.all([createAccount(t, 'Same'), createAccount(t, 'Same')]);
    expect(a.id).not.toBe(b.id);
  });

  it.each([
    ['balance: 500', { name: 'Eve', balance: 500 }, 'balance'],
    ['balance: 0', { name: 'Eve', balance: 0 }, 'balance'],
    ['id', { name: 'Eve', id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }, 'id'],
    ['created_at', { name: 'Eve', created_at: '2020-01-01T00:00:00Z' }, 'created_at'],
    ['an unknown key', { name: 'Eve', foo: 1 }, 'foo'],
  ])(
    'rejects a client-supplied %s instead of silently ignoring it',
    async (_label, body, field) => {
      const res = await t.http.post('/v1/accounts').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        expect.objectContaining({ field, rule: 'UNKNOWN_FIELD' }),
      ]);
    },
  );

  it.each([
    ['missing name', {}, 'REQUIRED'],
    ['null name', { name: null }, 'REQUIRED'],
    ['empty name', { name: '' }, 'BLANK'],
    ['whitespace-only name', { name: ' \t ' }, 'BLANK'],
    ['101-character name', { name: 'x'.repeat(101) }, 'TOO_LONG'],
    ['numeric name', { name: 123 }, 'INVALID_TYPE'],
    ['array name', { name: ['a'] }, 'INVALID_TYPE'],
    ['object name', { name: {} }, 'INVALID_TYPE'],
    ['control characters', { name: 'a\nb' }, 'INVALID_CHARACTERS'],
  ])('rejects %s', async (_label, body, rule) => {
    const res = await t.http.post('/v1/accounts').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ field: 'name', rule });
  });

  it('trims the name, keeps inner whitespace and unicode, accepts exactly 100 characters', async () => {
    expect((await createAccount(t, '  Alice  ')).name).toBe('Alice');
    expect((await createAccount(t, 'Mary  Ann')).name).toBe('Mary  Ann');
    expect((await createAccount(t, 'Zoë 🧾 山田')).name).toBe('Zoë 🧾 山田');
    expect((await createAccount(t, 'x'.repeat(100))).name).toHaveLength(100);
  });

  it('stores hostile input verbatim (parameterised queries)', async () => {
    const name = "Robert'); DROP TABLE accounts;--";
    const a = await createAccount(t, name);
    const fetched = await t.http.get(`/v1/accounts/${a.id}`);
    expect(fetched.body.name).toBe(name);
  });

  it('fetches an account, resolving upper-case ids to the same account', async () => {
    const a = await createAccount(t);
    const res = await t.http.get(`/v1/accounts/${a.id.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a.id);
  });

  it('reflects the balance on the account resource', async () => {
    const a = await createAccount(t);
    await postTx(t, { account_id: a.id, type: 'credit', amount: '12.30' });
    expect((await t.http.get(`/v1/accounts/${a.id}`)).body.balance).toBe('12.30');
  });

  it('returns 404 for an unknown account and 400 for a malformed id', async () => {
    const missing = await t.http.get('/v1/accounts/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(missing.body.error.context.account_id).toBe('00000000-0000-4000-8000-000000000000');

    for (const bad of ['not-a-uuid', '123', 'urn:uuid:3f2504e0-4f89-41d3-9a0c-0305e82c3301']) {
      const res = await t.http.get(`/v1/accounts/${bad}`);
      expect(res.status).toBe(400);
      expect(res.body.error.details[0]).toMatchObject({
        field: 'account_id',
        rule: 'INVALID_UUID',
      });
    }
  });

  it('exposes the balance endpoint with account_id and balance', async () => {
    const a = await createAccount(t);
    const res = await t.http.get(`/v1/accounts/${a.id}/balance`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ account_id: a.id, balance: '0.00' });
    expect(
      (await t.http.get('/v1/accounts/00000000-0000-4000-8000-000000000000/balance')).status,
    ).toBe(404);
    expect((await t.http.get('/v1/accounts/nope/balance')).status).toBe(400);
  });

  it.each(['put', 'patch', 'delete'] as const)(
    'does not allow %s on an account',
    async (method) => {
      const a = await createAccount(t);
      const res = await t.http[method](`/v1/accounts/${a.id}`).send({ name: 'x' });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
      expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
    },
  );

  it('answers 405 with Allow: POST on the collection', async () => {
    const res = await t.http.delete('/v1/accounts');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
    expect((await t.http.get('/v1/accounts')).status).toBe(405);
  });
});
