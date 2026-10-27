import {
  BadRequestException,
  type ArgumentsHost,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  DuplicateTransactionError,
  InsufficientBalanceError,
  MethodNotAllowedError,
} from './app.exception.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

function run(exception: unknown, req: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {};
  const state: { status?: number; body?: any } = {};
  const res = {
    setHeader: (k: string, v: string) => (headers[k] = v),
    status(code: number) {
      state.status = code;
      return this;
    },
    type() {
      return this;
    },
    send(payload: string) {
      state.body = JSON.parse(payload);
    },
  };
  const request = { method: 'GET', path: '/v1/x', originalUrl: '/v1/x?y=1', id: 'req-1', ...req };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { ...state, headers };
}

describe('HttpExceptionFilter', () => {
  let logged: MockInstance<Logger['error']>;
  beforeEach(() => {
    logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('renders app exceptions in the single envelope', () => {
    const out = run(
      new InsufficientBalanceError({
        accountId: 'a',
        balance: '100.00',
        requested: '150.00',
        shortfall: '50.00',
      }),
    );
    expect(out.status).toBe(422);
    expect(out.body).toEqual({
      error: {
        status: 422,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Debit of 150.00 exceeds available balance of 100.00',
        context: {
          account_id: 'a',
          balance: '100.00',
          requested_amount: '150.00',
          shortfall: '50.00',
        },
        request_id: 'req-1',
        timestamp: expect.any(String),
        path: '/v1/x?y=1',
      },
    });
  });

  it('applies exception headers (Allow on 405)', () => {
    const out = run(new MethodNotAllowedError('PUT', ['GET']));
    expect(out.status).toBe(405);
    expect(out.headers.Allow).toBe('GET');
    expect(out.body.error.context.allowed_methods).toEqual(['GET']);
  });

  it('embeds the existing transaction in a duplicate error', () => {
    const out = run(new DuplicateTransactionError('r1', { id: 't1' }));
    expect(out.status).toBe(409);
    expect(out.body.error.context.existing_transaction).toEqual({ id: 't1' });
  });

  it('turns the router 404 into ROUTE_NOT_FOUND naming the route', () => {
    const out = run(new NotFoundException(), { method: 'POST', path: '/v1/nope' });
    expect(out.status).toBe(404);
    expect(out.body.error).toMatchObject({
      code: 'ROUTE_NOT_FOUND',
      message: 'Cannot POST /v1/nope',
    });
  });

  it('turns framework 400s (body-parser failures) into MALFORMED_JSON', () => {
    const out = run(new BadRequestException('Unexpected token'));
    expect(out.status).toBe(400);
    expect(out.body.error.code).toBe('MALFORMED_JSON');
    expect(JSON.stringify(out.body)).not.toContain('Unexpected token');
  });

  it('recognises raw body-parser errors by their type', () => {
    expect(
      run(Object.assign(new Error('x'), { type: 'entity.too.large', status: 413 })).body.error.code,
    ).toBe('PAYLOAD_TOO_LARGE');
    expect(
      run(Object.assign(new SyntaxError('x'), { type: 'entity.parse.failed' })).body.error.code,
    ).toBe('MALFORMED_JSON');
    expect(run(Object.assign(new Error('x'), { type: 'encoding.unsupported' })).status).toBe(415);
  });

  it('hides internals of unexpected errors and logs them', () => {
    const out = run(new Error('relation "accounts" does not exist at /srv/app/src/x.ts:12'));
    expect(out.status).toBe(500);
    expect(out.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(out.body)).not.toMatch(/relation|srv|x\.ts/);
    expect(logged).toHaveBeenCalled();
  });

  it('never emits Nest default shapes for 5xx HttpExceptions either', () => {
    const out = run(new InternalServerErrorException('leaky detail'));
    expect(out.body.error.message).toBe('An unexpected error occurred');
    expect(Object.keys(out.body)).toEqual(['error']);
  });
});
