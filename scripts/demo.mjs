#!/usr/bin/env node
// Replays the worked examples from the assessment brief against a running API and asserts the results.
// Usage: node scripts/demo.mjs [--base http://localhost:3000]
import { randomUUID } from 'node:crypto';

const baseArg = process.argv.indexOf('--base');
const BASE = (
  baseArg > -1 ? process.argv[baseArg + 1] : (process.env.BASE_URL ?? 'http://localhost:3000')
).replace(/\/$/, '');
const run = randomUUID().slice(0, 8); // keeps reference ids unique across repeated runs

let failures = 0;
const log = (msg) => console.log(msg);

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  log(
    `${ok ? '  ok  ' : ' FAIL '} ${label}: ${JSON.stringify(actual)}${ok ? '' : `  (expected ${JSON.stringify(expected)})`}`,
  );
}

const account = async (name) => (await call('POST', '/v1/accounts', { name })).body;
const post = (accountId, type, amount, ref) =>
  call('POST', '/v1/transactions', {
    account_id: accountId,
    type,
    amount,
    reference_id: `${ref}-${run}`,
    description: `${type} ${amount}`,
  });
const balance = async (id) => (await call('GET', `/v1/accounts/${id}/balance`)).body.balance;

log(`Ledger demo against ${BASE}\n`);

log('1. Create account: balance starts at 0, the client cannot set it');
const a = await account('Alice');
expect('new account balance', a.balance, '0.00');
const rejected = await call('POST', '/v1/accounts', { name: 'Eve', balance: 500 });
expect(
  'client-supplied balance rejected',
  [rejected.status, rejected.body.error.code],
  [400, 'VALIDATION_ERROR'],
);

log('\n2. Balance consistency: 0 +100 +50 -30 -20 = 100');
for (const [type, amount, ref] of [
  ['credit', 100, 'c1'],
  ['credit', 50, 'c2'],
  ['debit', 30, 'd1'],
  ['debit', 20, 'd2'],
]) {
  const r = await post(a.id, type, amount, ref);
  log(`       ${type} ${amount} -> ${r.status}, balance_after ${r.body.balance_after}`);
}
expect('final balance', await balance(a.id), '100.00');

log('\n3. Insufficient balance: debit 150 on 100 is rejected and changes nothing');
const over = await post(a.id, 'debit', 150, 'd3');
expect('status/code', [over.status, over.body.error.code], [422, 'INSUFFICIENT_BALANCE']);
expect('balance unchanged', await balance(a.id), '100.00');

log(
  '\n4. Duplicate reference_id (same account): 409, existing transaction returned, no balance change',
);
const dup = await post(a.id, 'credit', 50, 'c2');
expect('status/code', [dup.status, dup.body.error.code], [409, 'DUPLICATE_TRANSACTION']);
expect(
  'existing transaction in body',
  dup.body.error.context.existing_transaction.reference_id,
  `c2-${run}`,
);
expect('balance unchanged', await balance(a.id), '100.00');

log('\n5. The same reference_id is fine on a different account');
const b = await account('Bob');
const other = await post(b.id, 'credit', 50, 'c2');
expect('status', other.status, 201);

log('\n6. History: latest first, filterable, paginated');
const history = await call('GET', `/v1/accounts/${a.id}/transactions?type=debit&page=1&limit=1`);
expect('first debit is the newest (20)', history.body.data[0].amount, '20.00');
expect('pagination meta', history.body.meta, {
  current_page: 1,
  page_size: 1,
  total_records: 2,
  total_pages: 2,
  has_next: true,
  has_previous: false,
});
const bad = await call('GET', `/v1/accounts/${a.id}/transactions?page=0`);
expect('invalid pagination', [bad.status, bad.body.error.code], [400, 'INVALID_PAGINATION']);

log('\n7. Immutability: transactions cannot be edited or deleted');
const txId = history.body.data[0].id;
for (const method of ['PUT', 'PATCH', 'DELETE']) {
  const r = await call(
    method,
    `/v1/transactions/${txId}`,
    method === 'DELETE' ? undefined : { amount: 1 },
  );
  expect(`${method} -> 405`, [r.status, r.body.error.code], [405, 'METHOD_NOT_ALLOWED']);
}

log('\n8. Bonus transfer: A=100, B=50, transfer 30 -> A=70, B=80');
const x = await account('Transfer A');
const y = await account('Transfer B');
await post(x.id, 'credit', 100, 'seed-x');
await post(y.id, 'credit', 50, 'seed-y');
const tr = await call('POST', '/v1/transfers', {
  source_account_id: x.id,
  destination_account_id: y.id,
  amount: 30,
  reference_id: `tr-${run}`,
});
expect('transfer status', tr.status, 201);
expect('A balance', await balance(x.id), '70.00');
expect('B balance', await balance(y.id), '80.00');
const over2 = await call('POST', '/v1/transfers', {
  source_account_id: x.id,
  destination_account_id: y.id,
  amount: 1000,
});
expect(
  'insufficient transfer rejected',
  [over2.status, over2.body.error.code],
  [422, 'INSUFFICIENT_BALANCE'],
);
expect('balances untouched (A)', await balance(x.id), '70.00');
expect('balances untouched (B)', await balance(y.id), '80.00');

log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
