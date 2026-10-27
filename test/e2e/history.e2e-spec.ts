import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount, fundedAccount, postTx, ref } from '../helpers/api.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('transaction history', () => {
  let t: TestApp;
  let a: { id: string };
  beforeAll(async () => {
    t = await createTestApp();
    a = await createAccount(t);
    for (let i = 1; i <= 25; i++) {
      await postTx(t, {
        account_id: a.id,
        type: i % 5 === 0 ? 'debit' : 'credit',
        amount: i % 5 === 0 ? 1 : 10,
        reference_id: `h-${i}`,
      });
    }
  });
  afterAll(async () => {
    await t.close();
  });

  const get = (query = '') => t.http.get(`/v1/accounts/${a.id}/transactions${query}`);

  it('defaults: page 1, limit 20, newest first, with the brief-literal pagination names', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.data[0].reference_id).toBe('h-25');
    expect(res.body.data[19].reference_id).toBe('h-6');
    expect(res.body.meta).toEqual({
      current_page: 1,
      page_size: 20,
      total_records: 25,
      total_pages: 2,
      has_next: true,
      has_previous: false,
    });
  });

  it('second page holds the remaining 5', async () => {
    const res = await get('?page=2');
    expect(res.body.data.map((r: { reference_id: string }) => r.reference_id)).toEqual([
      'h-5',
      'h-4',
      'h-3',
      'h-2',
      'h-1',
    ]);
    expect(res.body.meta).toMatchObject({ current_page: 2, has_next: false, has_previous: true });
  });

  it('filters by type and recomputes totals', async () => {
    const debits = await get('?type=debit');
    const credits = await get('?type=credit&limit=100');
    expect(debits.body.data.every((r: { type: string }) => r.type === 'debit')).toBe(true);
    expect(debits.body.meta.total_records).toBe(5);
    expect(credits.body.meta.total_records).toBe(20);
    expect(credits.body.data.every((r: { type: string }) => r.type === 'credit')).toBe(true);
  });

  it('every item has the same shape as a created transaction', async () => {
    const res = await get('?limit=1');
    expect(Object.keys(res.body.data[0]).sort()).toEqual([
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
  });

  it('accepts limit=100 and returns only the requested account', async () => {
    const other = await fundedAccount(t, 5);
    const res = await get('?limit=100');
    expect(res.body.meta.page_size).toBe(100);
    expect(res.body.data.every((r: { account_id: string }) => r.account_id === a.id)).toBe(true);
    expect(res.body.data.some((r: { account_id: string }) => r.account_id === other.id)).toBe(
      false,
    );
  });

  it('a page past the end is a 200 with empty data and truthful meta', async () => {
    const res = await get('?page=999');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toEqual({
      current_page: 999,
      page_size: 20,
      total_records: 25,
      total_pages: 2,
      has_next: false,
      has_previous: true,
    });
  });

  it.each([
    ['page=0', 'page', 'OUT_OF_RANGE'],
    ['page=-1', 'page', 'OUT_OF_RANGE'],
    ['page=1.5', 'page', 'NOT_INTEGER'],
    ['page=abc', 'page', 'NOT_INTEGER'],
    ['page=1e2', 'page', 'NOT_INTEGER'],
    ['page=%2B1', 'page', 'NOT_INTEGER'],
    ['page=', 'page', 'NOT_INTEGER'],
    ['page=99999999999999999999', 'page', 'OUT_OF_RANGE'],
    ['limit=0', 'limit', 'OUT_OF_RANGE'],
    ['limit=-5', 'limit', 'OUT_OF_RANGE'],
    ['limit=101', 'limit', 'OUT_OF_RANGE'],
    ['limit=abc', 'limit', 'NOT_INTEGER'],
    ['limit=2.5', 'limit', 'NOT_INTEGER'],
  ])('rejects %s with INVALID_PAGINATION', async (query, field, rule) => {
    const res = await get(`?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAGINATION');
    expect(res.body.error.details[0]).toMatchObject({ field, rule });
  });

  it('reports page and limit problems together in one response', async () => {
    const res = await get('?page=0&limit=0');
    expect(res.body.error.code).toBe('INVALID_PAGINATION');
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'limit',
      'page',
    ]);
  });

  it('INVALID_PAGINATION wins as the top-level code when type is also invalid, but all details are listed', async () => {
    const res = await get('?page=0&type=foo');
    expect(res.body.error.code).toBe('INVALID_PAGINATION');
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'page',
      'type',
    ]);
  });

  it.each(['CREDIT', 'Debit', 'transfer', ''])('rejects type=%j', async (type) => {
    const res = await get(`?type=${type}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ field: 'type', rule: 'INVALID_ENUM' });
  });

  it('rejects a repeated type parameter and unknown query parameters', async () => {
    expect((await get('?type=credit&type=debit')).status).toBe(400);
    const unknown = await get('?foo=1');
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details[0]).toMatchObject({ field: 'foo', rule: 'UNKNOWN_FIELD' });
  });

  it('accepts a zero-padded page as the number it denotes', async () => {
    expect((await get('?page=01')).body.meta.current_page).toBe(1);
  });

  it('is a 404 for an unknown account even though it would have zero rows, and 400 for a malformed id', async () => {
    expect(
      (await t.http.get('/v1/accounts/00000000-0000-4000-8000-000000000000/transactions')).status,
    ).toBe(404);
    expect((await t.http.get('/v1/accounts/nope/transactions')).status).toBe(400);
  });

  it('does not allow writes on the history resource', async () => {
    const res = await t.http.post(`/v1/accounts/${a.id}/transactions`).send({});
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET');
  });

  it('reflects a new transaction immediately at the top', async () => {
    const reference = ref('latest');
    await postTx(t, { account_id: a.id, type: 'credit', amount: 3, reference_id: reference });
    expect((await get('?limit=1')).body.data[0].reference_id).toBe(reference);
  });
});
