import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('env schema', () => {
  it('applies defaults and coerces numbers', () => {
    const env = validateEnv({ ...base, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.DB_LOCK_TIMEOUT_MS).toBe(5000);
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
