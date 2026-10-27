import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mapIssues } from '../validation/issue-mapper.js';
import { buildMeta, limitField, offsetFor, pageField } from './pagination.schema.js';

const parse = (schema: z.ZodType, value: unknown) => {
  const r = z
    .strictObject({ f: schema })
    .safeParse(value === undefined ? {} : { f: value }, { reportInput: true });
  return r.success
    ? { ok: true as const, value: r.data.f }
    : { ok: false as const, rule: mapIssues(r.error.issues, 'query')[0]?.rule };
};

describe('pageField / limitField', () => {
  it('defaults when absent', () => {
    expect(parse(pageField, undefined)).toEqual({ ok: true, value: 1 });
    expect(parse(limitField, undefined)).toEqual({ ok: true, value: 20 });
  });

  it.each([
    ['1', 1],
    ['01', 1],
    ['2147483647', 2147483647],
  ])('page %j -> %i', (input, expected) => {
    expect(parse(pageField, input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['1', 1],
    ['100', 100],
  ])('limit %j -> %i', (input, expected) => {
    expect(parse(limitField, input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['0', 'OUT_OF_RANGE'],
    ['-1', 'OUT_OF_RANGE'],
    ['2147483648', 'OUT_OF_RANGE'],
    ['99999999999999999999', 'OUT_OF_RANGE'],
    ['1.5', 'NOT_INTEGER'],
    ['abc', 'NOT_INTEGER'],
    ['1e2', 'NOT_INTEGER'],
    ['+1', 'NOT_INTEGER'],
    [' 1', 'NOT_INTEGER'],
    ['', 'NOT_INTEGER'],
  ])('rejects page %j as %s', (input, rule) => {
    expect(parse(pageField, input)).toEqual({ ok: false, rule });
  });

  it.each([
    ['0', 'OUT_OF_RANGE'],
    ['-5', 'OUT_OF_RANGE'],
    ['101', 'OUT_OF_RANGE'],
    ['2.5', 'NOT_INTEGER'],
    ['abc', 'NOT_INTEGER'],
  ])('rejects limit %j as %s', (input, rule) => {
    expect(parse(limitField, input)).toEqual({ ok: false, rule });
  });

  it('rejects a repeated parameter (array) as a type error', () => {
    expect(parse(pageField, ['1', '2'])).toEqual({ ok: false, rule: 'INVALID_TYPE' });
  });
});

describe('buildMeta', () => {
  it('computes total_pages as ceil(total / size)', () => {
    expect(buildMeta(1, 20, 25)).toEqual({
      current_page: 1,
      page_size: 20,
      total_records: 25,
      total_pages: 2,
      has_next: true,
      has_previous: false,
    });
    expect(buildMeta(2, 20, 25)).toMatchObject({ has_next: false, has_previous: true });
    expect(buildMeta(1, 20, 20)).toMatchObject({ total_pages: 1, has_next: false });
    expect(buildMeta(1, 20, 21)).toMatchObject({ total_pages: 2 });
  });

  it('has zero pages when empty and reports truthfully past the end', () => {
    expect(buildMeta(1, 20, 0)).toEqual({
      current_page: 1,
      page_size: 20,
      total_records: 0,
      total_pages: 0,
      has_next: false,
      has_previous: false,
    });
    expect(buildMeta(50, 20, 25)).toMatchObject({
      current_page: 50,
      total_pages: 2,
      has_next: false,
      has_previous: true,
    });
  });

  it('computes the offset', () => {
    expect(offsetFor(1, 20)).toBe(0);
    expect(offsetFor(3, 20)).toBe(40);
  });
});
