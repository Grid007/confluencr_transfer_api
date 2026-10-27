import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../src/common/errors/error-catalog.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

/** Every public operation must be documented. This is the source of truth for "what the API exposes". */
const EXPECTED_OPERATIONS = [
  'POST /v1/accounts',
  'GET /v1/accounts/{account_id}',
  'GET /v1/accounts/{account_id}/balance',
  'GET /v1/accounts/{account_id}/transactions',
  'POST /v1/transactions',
  'GET /v1/transactions/{transaction_id}',
  'POST /v1/transfers',
  'GET /v1/transfers/{transfer_id}',
  'GET /health',
];

describe('OpenAPI contract', () => {
  let t: TestApp;
  let doc: any;
  beforeAll(async () => {
    t = await createTestApp();
    doc = (await t.http.get('/docs-json')).body;
  });
  afterAll(async () => {
    await t.close();
  });

  const operations = () =>
    Object.entries<any>(doc.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );

  it('documents exactly the public operations, and no mutating endpoint for immutable records', () => {
    expect(operations().sort()).toEqual([...EXPECTED_OPERATIONS].sort());
    const mutating = operations().filter((o) => /^(PUT|PATCH|DELETE) /.test(o));
    expect(mutating).toEqual([]);
  });

  it('serves Swagger UI and the YAML document', async () => {
    const ui = await t.http.get('/docs');
    expect(ui.status).toBe(200);
    expect(ui.text.toLowerCase()).toContain('swagger');
    const yaml = await t.http.get('/docs-yaml');
    expect(yaml.status).toBe(200);
    expect(yaml.text).toContain('/v1/transactions');
  });

  it('documents request bodies generated from the Zod schemas', () => {
    const body = doc.paths['/v1/transactions'].post.requestBody.content['application/json'].schema;
    const schema = body.$ref ? doc.components.schemas[body.$ref.split('/').pop()] : body;
    expect(Object.keys(schema.properties).sort()).toEqual([
      'account_id',
      'amount',
      'description',
      'reference_id',
      'type',
    ]);
    expect(schema.required).toEqual(
      expect.arrayContaining(['account_id', 'type', 'amount', 'reference_id']),
    );
  });

  it('documents the history query parameters', () => {
    const names = doc.paths['/v1/accounts/{account_id}/transactions'].get.parameters.map(
      (p: { name: string }) => p.name,
    );
    expect(names).toEqual(expect.arrayContaining(['account_id', 'type', 'page', 'limit']));
  });

  it('documents every error code from the catalog', () => {
    const text = JSON.stringify(doc);
    const undocumented = ERROR_CODES.filter((code) => !text.includes(code));
    expect(undocumented).toEqual([]);
  });

  it('documents error responses with the shared envelope schema', () => {
    const responses = doc.paths['/v1/transactions'].post.responses;
    for (const status of ['400', '404', '409', '422', '500']) {
      expect(responses[status], `missing documented ${status}`).toBeDefined();
    }
    expect(Object.keys(responses['409'].content['application/json'].examples)).toContain(
      'DUPLICATE_TRANSACTION',
    );
  });

  it('matches the committed docs/openapi.json (run `pnpm openapi:export` after API changes)', () => {
    const committed = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../docs/openapi.json'), 'utf8'),
    );
    expect(doc).toEqual(committed);
  });
});
