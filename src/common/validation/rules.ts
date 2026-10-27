/** Stable, machine-readable reasons a single field failed validation. */
export const RULES = [
  'REQUIRED',
  'INVALID_TYPE',
  'INVALID_ENUM',
  'INVALID_UUID',
  'INVALID_AMOUNT',
  'BLANK',
  'TOO_LONG',
  'NOT_INTEGER',
  'OUT_OF_RANGE',
  'INVALID_CHARACTERS',
  'INVALID_FORMAT',
  'UNKNOWN_FIELD',
  'SAME_ACCOUNT',
] as const;

export type Rule = (typeof RULES)[number];

export interface ErrorDetail {
  field: string;
  rule: Rule;
  message: string;
}
