import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

type SchemaObject = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
import { ERROR_CATALOG, type ErrorCode } from '../errors/error-catalog.js';

export const errorEnvelopeSchema: SchemaObject = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['status', 'code', 'message', 'request_id', 'timestamp', 'path'],
      properties: {
        status: { type: 'integer', example: 422 },
        code: { type: 'string', example: 'INSUFFICIENT_BALANCE' },
        message: { type: 'string' },
        details: {
          type: 'array',
          description: 'Per-field failures (400 responses)',
          items: {
            type: 'object',
            required: ['field', 'rule', 'message'],
            properties: {
              field: { type: 'string' },
              rule: { type: 'string', example: 'INVALID_AMOUNT' },
              message: { type: 'string' },
            },
          },
        },
        context: { type: 'object', additionalProperties: true },
        request_id: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
        path: { type: 'string' },
      },
    },
  },
};

export function errorExample(code: ErrorCode) {
  const entry = ERROR_CATALOG[code];
  return {
    error: {
      status: entry.status,
      code,
      message: entry.example.message,
      ...(entry.example.details ? { details: entry.example.details } : {}),
      ...(entry.example.context ? { context: entry.example.context } : {}),
      request_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      timestamp: '2026-10-27T09:12:33.421Z',
      path: '/v1/example',
    },
  };
}

/** Documents error responses, grouping codes that share an HTTP status into one response with named examples. */
export function ApiErrorResponses(...codes: ErrorCode[]) {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_CATALOG[code].status;
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return applyDecorators(
    ...[...byStatus.entries()].map(([status, group]) =>
      ApiResponse({
        status,
        description: group.map((c) => ERROR_CATALOG[c].title).join(' / '),
        content: {
          'application/json': {
            schema: errorEnvelopeSchema,
            examples: Object.fromEntries(group.map((c) => [c, { value: errorExample(c) }])),
          },
        },
      }),
    ),
  );
}
