import postgres from 'postgres';
import {
  AppException,
  BalanceLimitExceededError,
  ConcurrencyConflictError,
  InsufficientBalanceError,
  UniqueViolationError,
} from './app.exception.js';

export const PG = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  RESTRICT_VIOLATION: '23001',
  NUMERIC_OUT_OF_RANGE: '22003',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
} as const;

/** Drizzle wraps driver errors in DrizzleQueryError; the SQLSTATE lives on the cause chain. */
export function pgError(err: unknown): postgres.PostgresError | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof postgres.PostgresError) return current;
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

/**
 * Translates database errors to domain errors. Unrecognised errors are returned unchanged
 * (they surface as 500). Check-violation on a balance column is a backstop for the explicit
 * balance check made under the row lock, which should make it unreachable.
 */
export function translatePgError(err: unknown): unknown {
  if (err instanceof AppException || err instanceof UniqueViolationError) return err;
  const pg = pgError(err);
  if (!pg) return err;

  switch (pg.code) {
    case PG.UNIQUE_VIOLATION:
      return new UniqueViolationError(pg.constraint_name);
    case PG.CHECK_VIOLATION:
      if (pg.constraint_name?.includes('balance')) {
        return new InsufficientBalanceError();
      }
      return err;
    case PG.NUMERIC_OUT_OF_RANGE:
      return new BalanceLimitExceededError();
    case PG.DEADLOCK_DETECTED:
    case PG.SERIALIZATION_FAILURE:
    case PG.LOCK_NOT_AVAILABLE:
      return new ConcurrencyConflictError();
    default:
      return err;
  }
}
