import type { z } from 'zod';
import type { ErrorDetail, Rule } from './rules.js';

export type Source = 'body' | 'query' | 'param' | 'custom';

type Issue = z.core.$ZodIssue;

const isMissing = (input: unknown): boolean => input === undefined || input === null;

function ruleFor(issue: Issue): Rule {
  const input = (issue as { input?: unknown }).input;

  if (issue.code === 'custom') {
    const rule = (issue as { params?: { rule?: Rule } }).params?.rule;
    return rule ?? 'INVALID_FORMAT';
  }
  // A missing/null value is "required" whatever the underlying schema said.
  if (isMissing(input)) return 'REQUIRED';

  switch (issue.code) {
    case 'invalid_type':
    case 'invalid_union':
      return 'INVALID_TYPE';
    case 'invalid_value':
      return Array.isArray(input) || typeof input === 'object' ? 'INVALID_TYPE' : 'INVALID_ENUM';
    case 'invalid_format':
      return issue.format === 'guid' || issue.format === 'uuid' ? 'INVALID_UUID' : 'INVALID_FORMAT';
    case 'too_small':
      return issue.origin === 'string' ? 'BLANK' : 'OUT_OF_RANGE';
    case 'too_big':
      return issue.origin === 'string' ? 'TOO_LONG' : 'OUT_OF_RANGE';
    default:
      return 'INVALID_FORMAT';
  }
}

const fieldName = (path: readonly PropertyKey[], source: Source): string =>
  path.length > 0 ? path.map(String).join('.') : source === 'custom' ? 'body' : source;

/**
 * Maps Zod issues to the public error vocabulary. One detail per field (first issue wins);
 * unrecognized keys fan out to one UNKNOWN_FIELD detail each.
 */
export function mapIssues(issues: readonly Issue[], source: Source): ErrorDetail[] {
  const seen = new Set<string>();
  const details: ErrorDetail[] = [];
  const push = (d: ErrorDetail) => {
    if (seen.has(d.field)) return;
    seen.add(d.field);
    details.push(d);
  };

  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const field = fieldName([...issue.path, key], source);
        push({ field, rule: 'UNKNOWN_FIELD', message: `${field} is not an allowed field` });
      }
      continue;
    }
    const field = fieldName(issue.path, source);
    push({ field, rule: ruleFor(issue), message: issue.message });
  }
  return details;
}
