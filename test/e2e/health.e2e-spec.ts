import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

describe('health', () => {
  it('reports ok with database latency, version and uptime when the database is reachable', async () => {
    const t = await createTestApp();
    try {
      const res = await t.http.get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        checks: { database: { status: 'up' }, ledger_access: { status: 'ok' } },
        version: '1.0.0',
      });
      expect(typeof res.body.checks.database.latency_ms).toBe('number');
      expect(typeof res.body.uptime_s).toBe('number');
      expect(res.headers['x-request-id']).toBeTruthy();
    } finally {
      await t.close();
    }
  });

  it('answers 503 in the standard error envelope when the database is unreachable', async () => {
    const t = await createTestApp({ DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none' });
    try {
      const res = await t.http.get('/health');
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
      expect(res.body.error.context.checks.database.status).toBe('down');
      expect(res.headers['retry-after']).toBe('1');
    } finally {
      await t.close();
    }
  });

  it('serves a friendly index at the root', async () => {
    const t = await createTestApp();
    try {
      const res = await t.http.get('/');
      expect(res.body).toMatchObject({ docs: '/docs', openapi: '/docs-json', health: '/health' });
    } finally {
      await t.close();
    }
  });
});
