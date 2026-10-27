import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getRequestId } from '../http/request-id.js';
import { AppException } from './app.exception.js';
import { ERROR_CATALOG, type ErrorCode } from './error-catalog.js';

interface Normalised {
  code: ErrorCode;
  status: number;
  message: string;
  details?: unknown[];
  context?: Record<string, unknown>;
  headers?: Record<string, string>;
}

interface BodyParserError {
  type?: string;
  status?: number;
  statusCode?: number;
  message?: string;
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'MALFORMED_JSON',
  404: 'ROUTE_NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Every non-2xx response, including framework and body-parser errors, leaves through here
 * in exactly one shape. Nest's default `{ statusCode, message, error }` never reaches a client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const n = this.normalise(exception, req);

    if (n.status >= 500) {
      this.logger.error(
        { err: exception, request_id: getRequestId(req), path: req.originalUrl },
        'unhandled error',
      );
    }
    for (const [name, value] of Object.entries(n.headers ?? {})) res.setHeader(name, value);

    const body = {
      error: {
        status: n.status,
        code: n.code,
        message: n.message,
        ...(n.details ? { details: n.details } : {}),
        ...(n.context ? { context: n.context } : {}),
        request_id: getRequestId(req),
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
      },
    };
    res.status(n.status).type('application/json').send(JSON.stringify(body));
  }

  private normalise(exception: unknown, req: Request): Normalised {
    if (exception instanceof AppException) {
      return {
        code: exception.code,
        status: exception.getStatus(),
        message: exception.message,
        details: exception.extra.details,
        context: exception.extra.context,
        headers: exception.extra.headers,
      };
    }

    // body-parser errors arrive as plain errors (or wrapped by Nest) carrying `type` and `status`.
    const bp = exception as BodyParserError;
    if (bp?.type === 'entity.too.large')
      return this.fromCode('PAYLOAD_TOO_LARGE', 'Request body is too large');
    if (bp?.type === 'entity.parse.failed' || exception instanceof SyntaxError) {
      return this.fromCode('MALFORMED_JSON', 'Request body is not valid JSON');
    }
    if (bp?.type === 'encoding.unsupported' || bp?.type === 'charset.unsupported') {
      return this.fromCode('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content encoding or charset');
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_TO_CODE[status];
      if (status === 404)
        return this.fromCode('ROUTE_NOT_FOUND', `Cannot ${req.method} ${req.path}`);
      if (status === 400) return this.fromCode('MALFORMED_JSON', 'Request body is not valid JSON');
      if (code) return this.fromCode(code, ERROR_CATALOG[code].title);
      if (status < 500) {
        return { code: 'INTERNAL_ERROR', status, message: exception.message };
      }
    }
    return this.fromCode('INTERNAL_ERROR', 'An unexpected error occurred');
  }

  private fromCode(code: ErrorCode, message: string): Normalised {
    return { code, status: ERROR_CATALOG[code].status, message };
  }
}
