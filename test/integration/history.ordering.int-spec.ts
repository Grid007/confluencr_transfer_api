import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { createAccount, fundedAccount, postTx, ref } from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

describe('history ordering and pagination', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  it('rows with an identical created_at are ordered by insertion sequence, newest first, stably', async () => {
    const a = await createAccount(t);
    const ledger = t.app.get(LedgerService);
    const refs = ['first', 'second', 'third'].map((n) => ref(n));
    await ledger.run(async (tx) => {
      const { postedAt } = await ledger.lockAccounts(tx, [{ id: a.id }]);
      for (const referenceId of refs) {
        await ledger.applyEntry(
          tx,
          { accountId: a.id, type: 'credit', amount: '1.00', referenceId, description: null },
          postedAt,
        );
      }
    });

    const times = await t.http.get(`/v1/accounts/${a.id}/transactions`);
    expect(new Set(times.body.data.map((r: { created_at: string }) => r.created_at)).size).toBe(1);

    for (let i = 0; i < 5; i++) {
      const res = await t.http.get(`/v1/accounts/${a.id}/transactions`);
      expect(res.body.data.map((r: { reference_id: string }) => r.reference_id)).toEqual(
        [...refs].reverse(),
      );
    }
  });

  it('timestamps are server-generated, ms precision, and never earlier than the account itself', async () => {
    const a = await createAccount(t);
    const first = await postTx(t, { account_id: a.id, type: 'credit', amount: 1 });
    const second = await postTx(t, { account_id: a.id, type: 'credit', amount: 1 });
    expect(Date.parse(first.body.created_at)).toBeGreaterThanOrEqual(Date.parse(a.created_at));
    expect(Date.parse(second.body.created_at)).toBeGreaterThanOrEqual(
      Date.parse(first.body.created_at),
    );
    expect(first.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('paging with limit=1 visits every transaction exactly once, newest first', async () => {
    const a = await fundedAccount(t, 0);
    const refs: string[] = [];
    for (let i = 0; i < 7; i++) {
      const referenceId = ref(`p${i}`);
      refs.push(referenceId);
      await postTx(t, { account_id: a.id, type: 'credit', amount: 1, reference_id: referenceId });
    }
    const seen: string[] = [];
    for (let page = 1; page <= 7; page++) {
      const res = await t.http.get(`/v1/accounts/${a.id}/transactions?page=${page}&limit=1`);
      expect(res.body.meta).toMatchObject({
        current_page: page,
        page_size: 1,
        total_records: 7,
        total_pages: 7,
      });
      seen.push(res.body.data[0].reference_id);
    }
    expect(seen).toEqual([...refs].reverse());
  });

  it('total_records follows the filter and a page past the end reports truthful meta', async () => {
    const a = await fundedAccount(t, 100);
    await postTx(t, { account_id: a.id, type: 'debit', amount: 10 });
    await postTx(t, { account_id: a.id, type: 'debit', amount: 10 });

    const credits = await t.http.get(`/v1/accounts/${a.id}/transactions?type=credit`);
    const debits = await t.http.get(`/v1/accounts/${a.id}/transactions?type=debit`);
    const all = await t.http.get(`/v1/accounts/${a.id}/transactions`);
    expect([
      credits.body.meta.total_records,
      debits.body.meta.total_records,
      all.body.meta.total_records,
    ]).toEqual([1, 2, 3]);

    const past = await t.http.get(`/v1/accounts/${a.id}/transactions?page=99&limit=2`);
    expect(past.status).toBe(200);
    expect(past.body.data).toEqual([]);
    expect(past.body.meta).toEqual({
      current_page: 99,
      page_size: 2,
      total_records: 3,
      total_pages: 2,
      has_next: false,
      has_previous: true,
    });
  });

  it('an account with no transactions has zero pages', async () => {
    const a = await createAccount(t);
    const res = await t.http.get(`/v1/accounts/${a.id}/transactions`);
    expect(res.body).toEqual({
      data: [],
      meta: {
        current_page: 1,
        page_size: 20,
        total_records: 0,
        total_pages: 0,
        has_next: false,
        has_previous: false,
      },
    });
  });
});
