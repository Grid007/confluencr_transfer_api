import { HttpException } from '@nestjs/common';
import type { z } from 'zod';
import type { ErrorDetail } from '../validation/rules.js';
import { mapIssues, type Source } from '../validation/issue-mapper.js';
import { ERROR_CATALOG, type ErrorCode } from './error-catalog.js';

export interface ExceptionExtra {
  details?: ErrorDetail[];
  context?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Base class for every error the API raises on purpose. The filter turns it into the one error envelope. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: ExceptionExtra = {},
  ) {
    super({ code, message, ...extra }, ERROR_CATALOG[code].status);
  }
}

export interface AccountRef {
  id: string;
  /** Request field the id came from (`source_account_id`, ...); omitted for path parameters. */
  field?: string;
}

export class AccountNotFoundError extends AppException {
  constructor(refs: readonly AccountRef[]) {
    const first = refs[0];
    const fields = refs.filter((r) => r.field);
    super('ACCOUNT_NOT_FOUND', `Account ${first?.id} not found`, {
      context: {
        account_id: first?.id,
        ...(fields.length > 0
          ? { missing: fields.map((r) => ({ field: r.field, account_id: r.id })) }
          : {}),
      },
    });
  }
}

export class TransactionNotFoundError extends AppException {
  constructor(id: string) {
    super('TRANSACTION_NOT_FOUND', `Transaction ${id} not found`, {
      context: { transaction_id: id },
    });
  }
}

export class TransferNotFoundError extends AppException {
  constructor(id: string) {
    super('TRANSFER_NOT_FOUND', `Transfer ${id} not found`, { context: { transfer_id: id } });
  }
}

export class DuplicateTransactionError extends AppException {
  constructor(referenceId: string, existing: Record<string, unknown>) {
    super(
      'DUPLICATE_TRANSACTION',
      `A transaction with reference_id '${referenceId}' already exists for this account`,
      { context: { existing_transaction: existing } },
    );
  }
}

export class DuplicateTransferError extends AppException {
  constructor(referenceId: string, existing: Record<string, unknown>) {
    super(
      'DUPLICATE_TRANSFER',
      `A transfer with reference_id '${referenceId}' already exists for the source account`,
      { context: { existing_transfer: existing } },
    );
  }
}

export class InsufficientBalanceError extends AppException {
  constructor(args?: { accountId: string; balance: string; requested: string; shortfall: string }) {
    super(
      'INSUFFICIENT_BALANCE',
      args
        ? `Debit of ${args.requested} exceeds available balance of ${args.balance}`
        : 'Insufficient balance',
      args
        ? {
            context: {
              account_id: args.accountId,
              balance: args.balance,
              requested_amount: args.requested,
              shortfall: args.shortfall,
            },
          }
        : {},
    );
  }
}

export class BalanceLimitExceededError extends AppException {
  constructor(accountId?: string) {
    super('BALANCE_LIMIT_EXCEEDED', 'Credit would exceed the maximum representable balance', {
      context: accountId ? { account_id: accountId } : undefined,
    });
  }
}

export class ConcurrencyConflictError extends AppException {
  constructor() {
    super('CONCURRENCY_CONFLICT', 'The request conflicted with a concurrent update; retry it', {
      headers: { 'Retry-After': '1' },
    });
  }
}

export class MethodNotAllowedError extends AppException {
  constructor(method: string, allowed: readonly string[]) {
    super(
      'METHOD_NOT_ALLOWED',
      `${method} is not supported on this resource${allowed.includes('GET') ? '; ledger records are immutable' : ''}`,
      { context: { allowed_methods: [...allowed] }, headers: { Allow: allowed.join(', ') } },
    );
  }
}

export class UnsupportedMediaTypeError extends AppException {
  constructor() {
    super('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
}

export class ServiceUnavailableError extends AppException {
  constructor(context: Record<string, unknown>) {
    super('SERVICE_UNAVAILABLE', 'The service is not ready: a dependency is unavailable', {
      context,
      headers: { 'Retry-After': '1' },
    });
  }
}

/** Raised by the validation pipe. Pagination failures win as the top-level code. */
export class RequestValidationError extends AppException {
  constructor(issues: readonly z.core.$ZodIssue[], source: Source) {
    const details = mapIssues(issues, source);
    const pagination =
      source === 'query' && details.some((d) => d.field === 'page' || d.field === 'limit');
    super(
      pagination ? 'INVALID_PAGINATION' : 'VALIDATION_ERROR',
      pagination ? 'Invalid pagination parameters' : 'Request validation failed',
      { details },
    );
  }
}

/** Internal only: a Postgres unique violation that the service layer recovers from. Never reaches HTTP. */
export class UniqueViolationError extends Error {
  constructor(readonly constraint: string | undefined) {
    super(`unique violation on ${constraint ?? 'unknown constraint'}`);
    this.name = 'UniqueViolationError';
  }
}
