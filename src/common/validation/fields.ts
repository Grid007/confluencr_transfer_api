import { z } from 'zod';
import { MAX_AMOUNT_MINOR, normalize, toMinor } from '../money/money.js';
import type { Rule } from './rules.js';

const CONTROL_CHARS = /\p{Cc}/u;
const AMOUNT_GRAMMAR = /^(0|[1-9]\d{0,12})(\.\d{1,2})?$/;

const rule = (r: Rule, message: string) => ({ message, params: { rule: r } });

/** RFC 4122-shaped UUID in any case; normalised to lowercase. */
export const uuidField = z
  .guid('must be a UUID')
  .transform((v) => v.toLowerCase())
  .meta({ format: 'uuid', example: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });

/** Account holder name: trimmed, 1..100 characters, no control characters. */
export const nameField = z
  .string()
  .trim()
  .min(1, 'name must not be blank')
  .max(100, 'name must be at most 100 characters')
  .refine(
    (v) => !CONTROL_CHARS.test(v),
    rule('INVALID_CHARACTERS', 'must not contain control characters'),
  )
  .meta({ example: 'Alice' });

/** Optional free text: trimmed, empty becomes null, at most 255 characters, no control characters. */
export const descriptionField = z
  .string()
  .trim()
  .max(255, 'description must be at most 255 characters')
  .refine(
    (v) => !CONTROL_CHARS.test(v),
    rule('INVALID_CHARACTERS', 'must not contain control characters'),
  )
  .nullish()
  .transform((v) => (v ? v : null))
  .meta({ example: 'Top-up' });

/** Client-supplied idempotency key: stored and compared verbatim (never trimmed). */
export const referenceIdField = z
  .string()
  .min(1, 'reference_id must not be blank')
  .max(128, 'reference_id must be at most 128 characters')
  .refine((v) => v.trim().length > 0, rule('BLANK', 'reference_id must not be blank'))
  .refine(
    (v) => v === v.trim(),
    rule('INVALID_FORMAT', 'reference_id must not have leading or trailing whitespace'),
  )
  .refine(
    (v) => !CONTROL_CHARS.test(v),
    rule('INVALID_CHARACTERS', 'must not contain control characters'),
  )
  .meta({ example: 'inv-1001' });

export const transactionTypeField = z.enum(['credit', 'debit'], {
  error: 'type must be one of: credit, debit',
});

const AMOUNT_MESSAGE =
  'amount must be a positive decimal with at most 2 decimal places, between 0.01 and 1000000000000.00';

/**
 * Accepts a JSON number or a numeric string. Strict decimal grammar, never rounded:
 * more than two decimals is rejected. Output is a normalised two-decimal string.
 */
export const amountField = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const text = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
    if (!AMOUNT_GRAMMAR.test(text)) {
      ctx.addIssue({ code: 'custom', message: AMOUNT_MESSAGE, params: { rule: 'INVALID_AMOUNT' } });
      return z.NEVER;
    }
    const minor = toMinor(text);
    if (minor <= 0n || minor > MAX_AMOUNT_MINOR) {
      ctx.addIssue({ code: 'custom', message: AMOUNT_MESSAGE, params: { rule: 'INVALID_AMOUNT' } });
      return z.NEVER;
    }
    return normalize(text);
  })
  .meta({ example: '50.00', description: 'Decimal, 0.01 to 1000000000000.00, at most 2 decimals' });
