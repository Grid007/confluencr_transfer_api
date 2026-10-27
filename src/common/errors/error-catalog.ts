export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_PAGINATION',
  'MALFORMED_JSON',
  'ACCOUNT_NOT_FOUND',
  'TRANSACTION_NOT_FOUND',
  'TRANSFER_NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'DUPLICATE_TRANSACTION',
  'DUPLICATE_TRANSFER',
  'CONCURRENCY_CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INSUFFICIENT_BALANCE',
  'BALANCE_LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface CatalogEntry {
  status: number;
  title: string;
  example: { message: string; details?: unknown[]; context?: Record<string, unknown> };
}

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** Single source of truth for status codes, used by the filter, OpenAPI examples and docs tests. */
export const ERROR_CATALOG: Record<ErrorCode, CatalogEntry> = {
  VALIDATION_ERROR: {
    status: 400,
    title: 'Request validation failed',
    example: {
      message: 'Request validation failed',
      details: [
        { field: 'amount', rule: 'INVALID_AMOUNT', message: 'amount must be a positive decimal' },
      ],
    },
  },
  INVALID_PAGINATION: {
    status: 400,
    title: 'Invalid pagination parameters',
    example: {
      message: 'Invalid pagination parameters',
      details: [
        { field: 'limit', rule: 'OUT_OF_RANGE', message: 'limit must be between 1 and 100' },
      ],
    },
  },
  MALFORMED_JSON: {
    status: 400,
    title: 'Request body is not valid JSON',
    example: { message: 'Request body is not valid JSON' },
  },
  ACCOUNT_NOT_FOUND: {
    status: 404,
    title: 'Account not found',
    example: { message: `Account ${ID} not found`, context: { account_id: ID } },
  },
  TRANSACTION_NOT_FOUND: {
    status: 404,
    title: 'Transaction not found',
    example: { message: `Transaction ${ID} not found`, context: { transaction_id: ID } },
  },
  TRANSFER_NOT_FOUND: {
    status: 404,
    title: 'Transfer not found',
    example: { message: `Transfer ${ID} not found`, context: { transfer_id: ID } },
  },
  ROUTE_NOT_FOUND: {
    status: 404,
    title: 'Route not found',
    example: { message: 'Cannot GET /v1/nope' },
  },
  METHOD_NOT_ALLOWED: {
    status: 405,
    title: 'Method not allowed',
    example: {
      message: 'DELETE is not supported on this resource; ledger records are immutable',
      context: { allowed_methods: ['GET'] },
    },
  },
  DUPLICATE_TRANSACTION: {
    status: 409,
    title: 'Transaction already exists',
    example: {
      message: "A transaction with reference_id 'inv-1001' already exists for this account",
      context: { existing_transaction: { id: ID, reference_id: 'inv-1001' } },
    },
  },
  DUPLICATE_TRANSFER: {
    status: 409,
    title: 'Transfer already exists',
    example: {
      message: "A transfer with reference_id 'tr-77' already exists for the source account",
      context: { existing_transfer: { id: ID, reference_id: 'tr-77' } },
    },
  },
  CONCURRENCY_CONFLICT: {
    status: 409,
    title: 'Concurrent update conflict',
    example: { message: 'The request conflicted with a concurrent update; retry it' },
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    title: 'Payload too large',
    example: { message: 'Request body exceeds the 100kb limit' },
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    title: 'Unsupported media type',
    example: { message: 'Content-Type must be application/json' },
  },
  INSUFFICIENT_BALANCE: {
    status: 422,
    title: 'Insufficient balance',
    example: {
      message: 'Debit of 150.00 exceeds available balance of 100.00',
      context: {
        account_id: ID,
        balance: '100.00',
        requested_amount: '150.00',
        shortfall: '50.00',
      },
    },
  },
  BALANCE_LIMIT_EXCEEDED: {
    status: 422,
    title: 'Balance limit exceeded',
    example: {
      message: 'Credit would exceed the maximum representable balance',
      context: { account_id: ID },
    },
  },
  INTERNAL_ERROR: {
    status: 500,
    title: 'Internal server error',
    example: { message: 'An unexpected error occurred' },
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    title: 'Service unavailable',
    example: {
      message: 'The database is not reachable',
      context: { checks: { database: { status: 'down' } } },
    },
  },
};
