import { z } from 'zod';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const MAX_PAGE = 2_147_483_647;

/**
 * Query-string integer. Rejects (never clamps): non-integers -> NOT_INTEGER, out of range -> OUT_OF_RANGE.
 * "01" is accepted as 1; an empty value is invalid.
 */
const intQuery = (name: string, min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return fallback;
      if (!/^-?\d+$/.test(v)) {
        ctx.addIssue({
          code: 'custom',
          message: `${name} must be an integer`,
          params: { rule: 'NOT_INTEGER' },
        });
        return z.NEVER;
      }
      const n = Number(v);
      if (!Number.isSafeInteger(n) || n < min || n > max) {
        ctx.addIssue({
          code: 'custom',
          message: `${name} must be between ${min} and ${max}`,
          params: { rule: 'OUT_OF_RANGE' },
        });
        return z.NEVER;
      }
      return n;
    })
    .meta({ type: 'integer', minimum: min, maximum: max, default: fallback });

export const pageField = intQuery('page', 1, MAX_PAGE, DEFAULT_PAGE);
export const limitField = intQuery('limit', 1, MAX_LIMIT, DEFAULT_LIMIT);

export interface PageMeta {
  current_page: number;
  page_size: number;
  total_records: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export function buildMeta(page: number, limit: number, totalRecords: number): PageMeta {
  const totalPages = Math.ceil(totalRecords / limit);
  return {
    current_page: page,
    page_size: limit,
    total_records: totalRecords,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_previous: page > 1,
  };
}

export const offsetFor = (page: number, limit: number): number => (page - 1) * limit;
