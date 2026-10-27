import { describe, expect, it } from 'vitest';
import { resolvePrepare, validateEnv } from './env.schema.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('env schema', () => {
  it('applies defaults and coerces numbers', () => {
    const env = validateEnv({ ...base, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.DB_LOCK_TIMEOUT_MS).toBe(5000);
    expect(env.DB_PREPARE).toBe('auto');
    expect(env.BODY_LIMIT).toBe('100kb');
  });

  it('rejects a non-postgres URL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow();
  });

  it('requires DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow();
  });

  it('rejects out-of-range values', () => {
    expect(() => validateEnv({ ...base, PORT: '0' })).toThrow();
    expect(() => validateEnv({ ...base, DB_LOCK_TIMEOUT_MS: '1' })).toThrow();
  });
});

describe('resolvePrepare', () => {
  it('honours explicit values', () => {
    expect(resolvePrepare('true', 'postgres://h:6543/db')).toBe(true);
    expect(resolvePrepare('false', 'postgres://h:5432/db')).toBe(false);
  });
  it('auto-disables on the transaction pooler port', () => {
    expect(resolvePrepare('auto', 'postgres://u:p@h:6543/postgres')).toBe(false);
  });
  it('auto-disables with pgbouncer=true', () => {
    expect(resolvePrepare('auto', 'postgres://u:p@h:5432/db?pgbouncer=true')).toBe(false);
  });
  it('auto keeps prepared statements on session mode / direct', () => {
    expect(resolvePrepare('auto', 'postgres://u:p@h:5432/db')).toBe(true);
  });
});
