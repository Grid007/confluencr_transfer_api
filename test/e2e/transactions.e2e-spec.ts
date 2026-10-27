import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, createAccount, fundedAccount, postTx, ref } from '../helpers/api.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('transactions', () => {
  let t: TestApp;
  let account: { id: string };
  beforeAll(async () => {
    t = await createTestApp();
    account = await createAccount(t);
  });
  afterAll(async () => {
    await t.close();
  });

  const valid = () => ({ account_id: account.id, type: 'credit', amount: 10, reference_id: ref() });
  const send = (over: Record<string, unknown>) =>
    t.http.post('/v1/transactions').send({ ...valid(), ...over });
  const sendRaw = (body: Record<string, unknown>) => t.http.post('/v1/transactions').send(body);

  it('creates a credit with the full transaction shape', async () => {
    const reference = ref();
    const res = await send({ reference_id: reference, description: 'Top-up', amount: '50' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      account_id: account.id,
      type: 'credit',
      amount: '50.00',
      description: 'Top-up',
      reference_id: reference,
      transfer_id: null,
    });
    expect(Object.keys(res.body).sort()).toEqual([
      'account_id',
      'amount',
      'balance_after',
      'created_at',
      'description',
      'id',
      'reference_id',
      'transfer_id',
      'type',
    ]);
    expect(res.headers.location).toBe(`/v1/transactions/${res.body.id}`);
    const fetched = await t.http.get(`/v1/transactions/${res.body.id}`);
    expect(fetched.body).toEqual(res.body);
  });

  it.each([
    [50, '50.00'],
    ['50', '50.00'],
    ['50.5', '50.50'],
    [50.5, '50.50'],
    [0.01, '0.01'],
    [1e2, '100.00'],
    ['1000000000000.00', '1000000000000.00'],
  ])('accepts amount %j and returns %s', async (amount, expected) => {
    const res = await send({ amount });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(expected);
  });

  it.each([
    ['zero', 0],
    ['zero string', '0.00'],
    ['negative', -5],
    ['negative string', '-5'],
    ['3 decimals (never rounded)', 50.005],
    ['3 decimals string', '50.005'],
    ['tiny', 0.001],
    ['exponent string', '5e1'],
    ['hex string', '0x32'],
    ['thousands separator', '1,000'],
    ['currency symbol', '$50'],
    ['leading dot', '.5'],
    ['trailing dot', '50.'],
    ['plus sign', '+50'],
    ['whitespace', ' 50'],
    ['above the maximum', 1e308],
    ['one cent above the maximum', '1000000000000.01'],
    ['non-numeric string', 'abc'],
    ['NaN string', 'NaN'],
    ['Infinity string', 'Infinity'],
  ])('rejects an invalid amount: %s', async (_label, amount) => {
    const res = await send({ amount });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ field: 'amount', rule: 'INVALID_AMOUNT' });
  });

  it.each([
    ['boolean', true],
    ['array', [50]],
    ['object', {}],
  ])('rejects a %s amount as INVALID_TYPE', async (_label, amount) => {
    const res = await send({ amount });
    expect(res.body.error.details[0]).toMatchObject({ field: 'amount', rule: 'INVALID_TYPE' });
  });

  it.each([
    ['missing', undefined, 'REQUIRED'],
    ['null', null, 'REQUIRED'],
  ])('reports a %s amount as REQUIRED', async (_label, amount, rule) => {
    const body: Record<string, unknown> = { ...valid() };
    if (amount === undefined) delete body.amount;
    else body.amount = amount;
    const res = await sendRaw(body);
    expect(res.body.error.details[0]).toMatchObject({ field: 'amount', rule });
  });

  it.each([
    ['CREDIT', 'INVALID_ENUM'],
    ['Debit', 'INVALID_ENUM'],
    ['credit ', 'INVALID_ENUM'],
    ['transfer', 'INVALID_ENUM'],
    ['withdrawal', 'INVALID_ENUM'],
    ['', 'INVALID_ENUM'],
    [1, 'INVALID_ENUM'],
    [['credit'], 'INVALID_TYPE'],
    [null, 'REQUIRED'],
  ])('rejects type %j as %s', async (type, rule) => {
    const res = await send({ type });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ field: 'type', rule });
  });

  it.each([
    ['missing', undefined, 'REQUIRED'],
    ['empty', '', 'BLANK'],
    ['whitespace', '   ', 'BLANK'],
    ['leading space', ' ref', 'INVALID_FORMAT'],
    ['trailing space', 'ref ', 'INVALID_FORMAT'],
    ['129 characters', 'x'.repeat(129), 'TOO_LONG'],
    ['a number', 123, 'INVALID_TYPE'],
    ['control characters', 'a\nb', 'INVALID_CHARACTERS'],
  ])('rejects reference_id: %s', async (_label, reference_id, rule) => {
    const body: Record<string, unknown> = { ...valid() };
    if (reference_id === undefined) delete body.reference_id;
    else body.reference_id = reference_id;
    const res = await sendRaw(body);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ field: 'reference_id', rule });
  });

  it('accepts a 128-character reference_id and stores it verbatim', async () => {
    const reference = 'x'.repeat(128);
    const a = await createAccount(t);
    const res = await postTx(t, {
      account_id: a.id,
      type: 'credit',
      amount: 1,
      reference_id: reference,
    });
    expect(res.status).toBe(201);
    expect(res.body.reference_id).toBe(reference);
  });

  it.each([
    ['omitted', undefined, null],
    ['null', null, null],
    ['empty', '', null],
    ['whitespace', '   ', null],
    ['trimmed', '  Rent ', 'Rent'],
    ['255 characters', 'x'.repeat(255), 'x'.repeat(255)],
  ])('normalises description: %s', async (_label, description, expected) => {
    const body: Record<string, unknown> = { ...valid() };
    if (description !== undefined) body.description = description;
    const res = await sendRaw(body);
    expect(res.status).toBe(201);
    expect(res.body.description).toBe(expected);
  });

  it.each([
    ['256 characters', 'x'.repeat(256), 'TOO_LONG'],
    ['a number', 123, 'INVALID_TYPE'],
  ])('rejects description: %s', async (_label, description, rule) => {
    const res = await send({ description });
    expect(res.body.error.details[0]).toMatchObject({ field: 'description', rule });
  });

  it.each([
    ['missing', undefined, 'REQUIRED'],
    ['malformed', 'abc', 'INVALID_UUID'],
    ['a number', 12345, 'INVALID_TYPE'],
  ])('rejects account_id: %s', async (_label, account_id, rule) => {
    const body: Record<string, unknown> = { ...valid() };
    if (account_id === undefined) delete body.account_id;
    else body.account_id = account_id;
    const res = await sendRaw(body);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ field: 'account_id', rule });
  });

  it('returns 404 for a well-formed account that does not exist', async () => {
    const res = await send({ account_id: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it.each(['id', 'created_at', 'balance_after', 'transfer_id', 'balance', 'foo'])(
    'rejects a client-supplied %s',
    async (key) => {
      const res = await send({ [key]: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        expect.objectContaining({ field: key, rule: 'UNKNOWN_FIELD' }),
      ]);
    },
  );

  it('reports every invalid field in a single response', async () => {
    const res = await send({ type: 'x', amount: 'abc', reference_id: '', foo: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'amount',
      'foo',
      'reference_id',
      'type',
    ]);
  });

  it('sets created_at on the server and never earlier than the previous posting', async () => {
    const a = await createAccount(t);
    const first = await postTx(t, { account_id: a.id, type: 'credit', amount: 1 });
    const second = await postTx(t, { account_id: a.id, type: 'credit', amount: 1 });
    expect(Date.parse(second.body.created_at)).toBeGreaterThanOrEqual(
      Date.parse(first.body.created_at),
    );
  });

  it('keeps money exact: 0.10 + 0.20 then a debit of 0.30 leaves exactly 0.00', async () => {
    const a = await createAccount(t);
    await postTx(t, { account_id: a.id, type: 'credit', amount: '0.10' });
    await postTx(t, { account_id: a.id, type: 'credit', amount: '0.20' });
    const res = await postTx(t, { account_id: a.id, type: 'debit', amount: '0.30' });
    expect(res.status).toBe(201);
    expect(await balanceOf(t, a.id)).toBe('0.00');
  });

  it('allows a debit of exactly the balance, rejects one cent more with the exact shortfall', async () => {
    const a = await fundedAccount(t, 100);
    const over = await postTx(t, { account_id: a.id, type: 'debit', amount: '100.01' });
    expect(over.status).toBe(422);
    expect(over.body.error.context).toEqual({
      account_id: a.id,
      balance: '100.00',
      requested_amount: '100.01',
      shortfall: '0.01',
    });
    expect((await postTx(t, { account_id: a.id, type: 'debit', amount: '100.00' })).status).toBe(
      201,
    );
    expect(await balanceOf(t, a.id)).toBe('0.00');
    expect((await postTx(t, { account_id: a.id, type: 'debit', amount: '0.01' })).status).toBe(422);
  });

  it('duplicate check precedes the balance check', async () => {
    const a = await fundedAccount(t, 10);
    const reference = ref();
    await postTx(t, { account_id: a.id, type: 'credit', amount: 1, reference_id: reference });
    const res = await postTx(t, {
      account_id: a.id,
      type: 'debit',
      amount: 999,
      reference_id: reference,
    });
    expect(res.status).toBe(409);
  });

  it('GET /transactions/:id returns 404 and 400 appropriately', async () => {
    expect(
      (await t.http.get('/v1/transactions/00000000-0000-4000-8000-000000000000')).body.error.code,
    ).toBe('TRANSACTION_NOT_FOUND');
    expect((await t.http.get('/v1/transactions/nope')).status).toBe(400);
  });

  it.each(['put', 'patch', 'delete', 'post'] as const)(
    'answers 405 with Allow: GET for %s on a transaction',
    async (method) => {
      const a = await fundedAccount(t, 1);
      const hist = await t.http.get(`/v1/accounts/${a.id}/transactions`);
      const res = await t.http[method](`/v1/transactions/${hist.body.data[0].id}`).send({});
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
    },
  );

  it('answers 405 before checking existence (no information leak)', async () => {
    const res = await t.http.put('/v1/transactions/00000000-0000-4000-8000-000000000000').send({});
    expect(res.status).toBe(405);
  });

  it('has no list-all endpoint: GET /transactions is 405 with Allow: POST', async () => {
    const res = await t.http.get('/v1/transactions');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});
