import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id.js';

describe('resolveRequestId', () => {
  it('accepts a well-formed client id', () => {
    expect(resolveRequestId('abc-123_X.y')).toBe('abc-123_X.y');
  });

  it.each(['a b', 'x'.repeat(129), 'line\nbreak', '', 'semi;colon'])(
    'replaces invalid id %j',
    (bad) => {
      const id = resolveRequestId(bad);
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('generates when absent and uses the first of repeated headers', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(['first', 'second'])).toBe('first');
  });
});
