import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorExample } from '../swagger/api-error-responses.decorator.js';
import {
  AccountNotFoundError,
  AppException,
  BalanceLimitExceededError,
  ConcurrencyConflictError,
  DuplicateTransactionError,
  DuplicateTransferError,
  InsufficientBalanceError,
  MethodNotAllowedError,
  RequestValidationError,
  ServiceUnavailableError,
  TransactionNotFoundError,
  TransferNotFoundError,
  UnsupportedMediaTypeError,
} from './app.exception.js';
import { ERROR_CATALOG, ERROR_CODES } from './error-catalog.js';

describe('error catalog', () => {
  it('has an entry for every code, with a plausible HTTP status and an example', () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_CATALOG[code];
      expect(entry, code).toBeDefined();
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
      expect(entry.example.message.length).toBeGreaterThan(0);
    }
  });

  it('every exception class carries the status its catalog entry declares', () => {
    const cases: Array<[AppException, number]> = [
      [new AccountNotFoundError([{ id: 'x' }]), 404],
      [new TransactionNotFoundError('x'), 404],
      [new TransferNotFoundError('x'), 404],
      [new DuplicateTransactionError('r', {}), 409],
      [new DuplicateTransferError('r', {}), 409],
      [new ConcurrencyConflictError(), 409],
      [new InsufficientBalanceError(), 422],
      [new BalanceLimitExceededError(), 422],
      [new MethodNotAllowedError('PUT', ['GET']), 405],
      [new UnsupportedMediaTypeError(), 415],
      [new ServiceUnavailableError({}), 503],
      [new RequestValidationError([], 'body'), 400],
    ];
    for (const [exception, status] of cases) {
      expect(exception.getStatus(), exception.code).toBe(status);
      expect(ERROR_CATALOG[exception.code].status, exception.code).toBe(status);
    }
  });

  it('documentation examples follow the envelope shape', () => {
    for (const code of ERROR_CODES) {
      const { error } = errorExample(code);
      expect(error.code).toBe(code);
      expect(error.status).toBe(ERROR_CATALOG[code].status);
      expect(Object.keys(error)).toEqual(
        expect.arrayContaining(['status', 'code', 'message', 'request_id', 'timestamp', 'path']),
      );
    }
  });

  it('docs/API.md documents every error code', () => {
    const file = resolve(import.meta.dirname, '../../../docs/API.md');
    expect(existsSync(file), 'docs/API.md must exist').toBe(true);
    const text = readFileSync(file, 'utf8');
    const missing = ERROR_CODES.filter((code) => !text.includes(`\`${code}\``));
    expect(missing).toEqual([]);
  });
});
