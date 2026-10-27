import { DrizzleQueryError } from 'drizzle-orm';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  AppException,
  BalanceLimitExceededError,
  ConcurrencyConflictError,
  InsufficientBalanceError,
  UniqueViolationError,
} from './app.exception.js';
import { pgError, translatePgError } from './pg-error.js';

const pg = (code: string, extra: Record<string, unknown> = {}) =>
  new postgres.PostgresError({ code, message: `pg ${code}`, ...extra } as never);
const wrapped = (inner: Error) => new DrizzleQueryError('select 1', [], inner);

describe('pgError', () => {
  it('finds the PostgresError inside a DrizzleQueryError', () => {
    const inner = pg('23505');
    expect(pgError(wrapped(inner))).toBe(inner);
  });
  it('finds a bare PostgresError', () => {
    const inner = pg('23505');
    expect(pgError(inner)).toBe(inner);
  });
  it('returns undefined for other errors', () => {
    expect(pgError(new Error('x'))).toBeUndefined();
    expect(pgError('string')).toBeUndefined();
    expect(pgError(undefined)).toBeUndefined();
  });
});

describe('translatePgError', () => {
  it('maps unique violations to an internal UniqueViolationError carrying the constraint', () => {
    const out = translatePgError(
      wrapped(pg('23505', { constraint_name: 'transactions_account_reference_uq' })),
    );
    expect(out).toBeInstanceOf(UniqueViolationError);
    expect((out as UniqueViolationError).constraint).toBe('transactions_account_reference_uq');
  });

  it('maps a balance CHECK violation to INSUFFICIENT_BALANCE', () => {
    const out = translatePgError(
      wrapped(pg('23514', { constraint_name: 'accounts_balance_non_negative' })),
    );
    expect(out).toBeInstanceOf(InsufficientBalanceError);
    expect((out as AppException).getStatus()).toBe(422);
  });

  it('leaves other CHECK violations untouched (they are bugs, so they surface as 500)', () => {
    const err = wrapped(pg('23514', { constraint_name: 'transactions_amount_positive' }));
    expect(translatePgError(err)).toBe(err);
  });

  it('maps numeric overflow to BALANCE_LIMIT_EXCEEDED', () => {
    expect(translatePgError(wrapped(pg('22003')))).toBeInstanceOf(BalanceLimitExceededError);
  });

  it.each(['40P01', '40001', '55P03'])(
    'maps %s to CONCURRENCY_CONFLICT with Retry-After',
    (code) => {
      const out = translatePgError(wrapped(pg(code)));
      expect(out).toBeInstanceOf(ConcurrencyConflictError);
      expect((out as AppException).extra.headers).toEqual({ 'Retry-After': '1' });
    },
  );

  it('passes through app exceptions and unknown errors unchanged', () => {
    const app = new ConcurrencyConflictError();
    expect(translatePgError(app)).toBe(app);
    const other = new Error('boom');
    expect(translatePgError(other)).toBe(other);
    const unknownPg = wrapped(pg('XX000'));
    expect(translatePgError(unknownPg)).toBe(unknownPg);
  });
});
