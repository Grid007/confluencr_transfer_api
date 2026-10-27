import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { balanceOf, fundedAccount, postTx } from '../helpers/api.js';
import { assertLedgerConsistent } from '../helpers/db-assert.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Holds the account row lock from a separate connection until `release()` is called. */
async function holdLock(accountId: string) {
  const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => undefined });
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let held!: () => void;
  const lockHeld = new Promise<void>((r) => (held = r));
  const done = client.begin(async (tx) => {
    await tx`select id from accounts where id = ${accountId} for no key update`;
    held();
    await released;
  });
  await lockHeld;
  return {
    release,
    finish: async () => {
      release();
      await done;
      await client.end({ timeout: 5 });
    },
  };
}

describe('row locking', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await assertLedgerConsistent(t.db);
    await t.close();
  });

  it('a posting waits for a concurrent lock holder, then succeeds', async () => {
    const a = await fundedAccount(t, 100);
    const lock = await holdLock(a.id);

    const started = Date.now();
    const pending = postTx(t, { account_id: a.id, type: 'debit', amount: 40 });
    await sleep(1000);
    await lock.finish();
    const res = await pending;

    expect(res.status).toBe(201);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900); // it really did block on the lock
    expect(await balanceOf(t, a.id)).toBe('60.00');
  });

  it('a stuck lock becomes a 409 CONCURRENCY_CONFLICT with Retry-After, not a hung request or a 500', async () => {
    const impatient = await createTestApp({ DB_LOCK_TIMEOUT_MS: '300' });
    try {
      const a = await fundedAccount(impatient, 100);
      const lock = await holdLock(a.id);
      const started = Date.now();
      const res = await postTx(impatient, { account_id: a.id, type: 'debit', amount: 10 });
      const elapsed = Date.now() - started;
      await lock.finish();

      // 300ms lock_timeout, not the 5000ms default: proves the per-app setting is really applied.
      expect(elapsed).toBeLessThan(3000);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENCY_CONFLICT');
      expect(res.headers['retry-after']).toBe('1');
      expect(await balanceOf(impatient, a.id)).toBe('100.00');
    } finally {
      await impatient.close();
    }
  });
});
