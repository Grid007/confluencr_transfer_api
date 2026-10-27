import type { NextFunction, Request, Response } from 'express';
import { UnsupportedMediaTypeError } from '../errors/app.exception.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Write requests that carry a body must be application/json. Only the JSON parser is registered,
 * so any other body would silently be ignored; reject it explicitly with 415 instead.
 */
export function requireJsonBody(req: Request, _res: Response, next: NextFunction): void {
  if (!WRITE_METHODS.has(req.method)) return next();
  const hasBody =
    req.headers['transfer-encoding'] !== undefined ||
    Number(req.headers['content-length'] ?? 0) > 0;
  if (!hasBody) return next();
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type === 'application/json') return next();
  next(new UnsupportedMediaTypeError());
}
