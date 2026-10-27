import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Accepts a well-formed client id, otherwise generates one (never trusts arbitrary header content). */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}

/**
 * First middleware in the chain, so that even body-parser failures carry a request id.
 * The same id is used by pino-http (see LoggerModule) and echoed in error bodies.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export const getRequestId = (req: Request): string =>
  typeof req.id === 'string' ? req.id : resolveRequestId(undefined);
