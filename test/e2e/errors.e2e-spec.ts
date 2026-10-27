import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount } from '../helpers/api.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

const ENVELOPE_KEYS = ['code', 'message', 'path', 'request_id', 'status', 'timestamp'];

function expectEnvelope(
  res: { status: number; body: any; headers: Record<string, string> },
  status: number,
  code: string,
) {
  expect(res.status).toBe(status);
  expect(Object.keys(res.body)).toEqual(['error']); // Nest's default { statusCode, message, error } must never appear
  expect(res.body.error).toMatchObject({ status, code });
  for (const key of ENVELOPE_KEYS) expect(res.body.error).toHaveProperty(key);
  expect(res.headers['x-request-id']).toBe(res.body.error.request_id);
  expect(res.headers['content-type']).toContain('application/json');
}

describe('error handling', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  const json = (path: string, raw: string) =>
    t.http.post(path).set('content-type', 'application/json').send(raw);

  it('unknown routes are 404 ROUTE_NOT_FOUND for every method', async () => {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      expectEnvelope(await t.http[method]('/v1/nope'), 404, 'ROUTE_NOT_FOUND');
    }
    const res = await t.http.get('/v1/accounts/x/y/z');
    expectEnvelope(res, 404, 'ROUTE_NOT_FOUND');
    expect(res.body.error.path).toBe('/v1/accounts/x/y/z');
  });

  it.each([
    ['trailing comma', '{"name":"A",}'],
    ['unterminated', '{"name":"A"'],
    ['single quotes', "{'name':'A'}"],
    ['NaN literal', '{"name":"A","x":NaN}'],
    ['bare number', '42'],
    ['bare string', '"x"'],
    ['null', 'null'],
    ['garbage', 'not json at all'],
  ])('malformed JSON (%s) is 400 MALFORMED_JSON and persists nothing', async (_label, raw) => {
    expectEnvelope(await json('/v1/accounts', raw), 400, 'MALFORMED_JSON');
  });

  it('a JSON array body is a validation error on "body"', async () => {
    const res = await t.http.post('/v1/accounts').send([{ name: 'A' }]);
    expectEnvelope(res, 400, 'VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ field: 'body', rule: 'INVALID_TYPE' });
  });

  it('an empty body is a validation error on "body"', async () => {
    const res = await t.http.post('/v1/accounts');
    expectEnvelope(res, 400, 'VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ field: 'body', rule: 'REQUIRED' });
  });

  it('non-JSON content types are 415 and persist nothing', async () => {
    expectEnvelope(
      await t.http.post('/v1/accounts').set('content-type', 'text/plain').send('{"name":"X"}'),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expectEnvelope(
      await t.http.post('/v1/accounts').type('form').send('name=Alice'),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  it('accepts Content-Type with a charset parameter', async () => {
    const res = await t.http
      .post('/v1/accounts')
      .set('content-type', 'application/json; charset=utf-8')
      .send('{"name":"Charset"}');
    expect(res.status).toBe(201);
  });

  it('a body over 100kb is 413 PAYLOAD_TOO_LARGE', async () => {
    expectEnvelope(
      await t.http.post('/v1/accounts').send({ name: 'x'.repeat(110_000) }),
      413,
      'PAYLOAD_TOO_LARGE',
    );
  });

  it('a NUL character in a string is rejected before it can reach the database', async () => {
    const res = await json('/v1/accounts', '{"name":"a\\u0000b"}');
    expectEnvelope(res, 400, 'VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ field: 'name', rule: 'INVALID_CHARACTERS' });
  });

  it('validation errors, not found, duplicates and balance errors all share the envelope', async () => {
    const a = await createAccount(t);
    expectEnvelope(await t.http.post('/v1/transactions').send({}), 400, 'VALIDATION_ERROR');
    expectEnvelope(
      await t.http.get('/v1/accounts/00000000-0000-4000-8000-000000000000'),
      404,
      'ACCOUNT_NOT_FOUND',
    );
    expectEnvelope(
      await t.http.get(`/v1/accounts/${a.id}/transactions?page=0`),
      400,
      'INVALID_PAGINATION',
    );
    expectEnvelope(await t.http.delete(`/v1/accounts/${a.id}`), 405, 'METHOD_NOT_ALLOWED');
    const debit = await t.http
      .post('/v1/transactions')
      .send({ account_id: a.id, type: 'debit', amount: 5, reference_id: 'r' });
    expectEnvelope(debit, 422, 'INSUFFICIENT_BALANCE');
  });

  describe('request id', () => {
    it('is generated for every response, success or error', async () => {
      const ok = await t.http.get('/');
      expect(ok.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('echoes a well-formed client id into the header and the error body', async () => {
      const res = await t.http.get('/v1/nope').set('X-Request-Id', 'probe-123');
      expect(res.headers['x-request-id']).toBe('probe-123');
      expect(res.body.error.request_id).toBe('probe-123');
    });

    it.each(['a b', 'x'.repeat(129), 'semi;colon'])(
      'replaces the invalid client id %j',
      async (bad) => {
        const res = await t.http.get('/v1/nope').set('X-Request-Id', bad);
        expect(res.headers['x-request-id']).not.toBe(bad);
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      },
    );

    it('also covers body-parser failures', async () => {
      const res = await json('/v1/accounts', '{').set('X-Request-Id', 'bp-1');
      expect(res.body.error.request_id).toBe('bp-1');
    });
  });

  describe('response conventions', () => {
    it('uses snake_case keys, ISO-8601 UTC timestamps, lowercase UUIDs and string money', async () => {
      const a = await createAccount(t);
      const res = await t.http
        .post('/v1/transactions')
        .send({ account_id: a.id.toUpperCase(), type: 'credit', amount: 1, reference_id: 'conv' });
      expect(res.status).toBe(201);
      for (const key of Object.keys(res.body)) expect(key).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(res.body.account_id).toBe(a.id);
      expect(res.body.created_at).toMatch(/Z$/);
      expect(typeof res.body.amount).toBe('string');
      expect(typeof res.body.balance_after).toBe('string');
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    });

    it('stores hostile strings verbatim and never leaks internals on errors', async () => {
      const res = await t.http.get("/v1/accounts/1' OR '1'='1");
      expectEnvelope(res, 400, 'VALIDATION_ERROR');
      expect(JSON.stringify(res.body)).not.toMatch(/select |postgres|stack|at .*\.ts/i);
    });
  });
});
