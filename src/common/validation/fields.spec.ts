import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mapIssues } from './issue-mapper.js';
import {
  amountField,
  descriptionField,
  nameField,
  referenceIdField,
  transactionTypeField,
  uuidField,
} from './fields.js';

/** Runs a single-field object schema the way the pipe does (reportInput on) and returns rule(s). */
function check(field: z.ZodType, value: unknown, present = true) {
  const schema = z.strictObject({ f: field });
  const result = schema.safeParse(present ? { f: value } : {}, { reportInput: true });
  if (result.success) return { ok: true as const, value: result.data.f };
  const details = mapIssues(result.error.issues, 'body');
  return { ok: false as const, rule: details[0]?.rule, field: details[0]?.field };
}

describe('amountField', () => {
  it.each([
    [50, '50.00'],
    ['50', '50.00'],
    ['50.5', '50.50'],
    [50.5, '50.50'],
    ['50.00', '50.00'],
    [1e2, '100.00'],
    [0.01, '0.01'],
    ['0.01', '0.01'],
    [1_000_000_000_000, '1000000000000.00'],
    ['1000000000000.00', '1000000000000.00'],
  ])('accepts %j -> %s', (input, expected) => {
    expect(check(amountField, input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    0,
    '0',
    '0.00',
    -5,
    '-5',
    -0,
    50.005,
    '50.005',
    0.001,
    1e-7,
    1e308,
    Number('1000000000000.01'),
    '1000000000000.01',
    Number('9007199254740993'),
    'abc',
    'NaN',
    'Infinity',
    '-Infinity',
    ' 50',
    '50 ',
    '5e1',
    '0x32',
    '1,000',
    '$50',
    '.5',
    '50.',
    '+50',
    '',
  ])('rejects %j as INVALID_AMOUNT', (input) => {
    expect(check(amountField, input)).toMatchObject({ ok: false, rule: 'INVALID_AMOUNT' });
  });

  it.each([true, false, [50], {}, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-number/string %j as INVALID_TYPE',
    (input) => {
      expect(check(amountField, input)).toMatchObject({ ok: false, rule: 'INVALID_TYPE' });
    },
  );

  it('reports missing and null as REQUIRED', () => {
    expect(check(amountField, undefined, false)).toMatchObject({ ok: false, rule: 'REQUIRED' });
    expect(check(amountField, null)).toMatchObject({ ok: false, rule: 'REQUIRED' });
  });
});

describe('nameField', () => {
  it.each([
    ['Alice', 'Alice'],
    ['  Alice  ', 'Alice'],
    ['Mary  Ann', 'Mary  Ann'],
    ['Zoë 🧾 山田', 'Zoë 🧾 山田'],
    ['x'.repeat(100), 'x'.repeat(100)],
  ])('accepts %j', (input, expected) => {
    expect(check(nameField, input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', 'BLANK'],
    ['   ', 'BLANK'],
    ['\t\n ', 'BLANK'],
    ['x'.repeat(101), 'TOO_LONG'],
    ['a\u0000b', 'INVALID_CHARACTERS'],
    ['a\nb', 'INVALID_CHARACTERS'],
    [123, 'INVALID_TYPE'],
    [true, 'INVALID_TYPE'],
    [['a'], 'INVALID_TYPE'],
    [{}, 'INVALID_TYPE'],
    [null, 'REQUIRED'],
  ])('rejects %j as %s', (input, rule) => {
    expect(check(nameField, input)).toMatchObject({ ok: false, rule });
  });

  it('reports a missing name as REQUIRED', () => {
    expect(check(nameField, undefined, false)).toMatchObject({
      ok: false,
      rule: 'REQUIRED',
      field: 'f',
    });
  });
});

describe('referenceIdField', () => {
  it.each(['r1', 'REF-1', 'inv/2026:10-27', 'x'.repeat(128), 'ünï-ré'])(
    'accepts %j verbatim',
    (v) => {
      expect(check(referenceIdField, v)).toEqual({ ok: true, value: v });
    },
  );

  it.each([
    ['', 'BLANK'],
    ['   ', 'BLANK'],
    [' ref-1', 'INVALID_FORMAT'],
    ['ref-1 ', 'INVALID_FORMAT'],
    ['x'.repeat(129), 'TOO_LONG'],
    ['a\nb', 'INVALID_CHARACTERS'],
    ['a\u0000b', 'INVALID_CHARACTERS'],
    [123, 'INVALID_TYPE'],
    [null, 'REQUIRED'],
  ])('rejects %j as %s', (input, rule) => {
    expect(check(referenceIdField, input)).toMatchObject({ ok: false, rule });
  });

  it('reports missing as REQUIRED', () => {
    expect(check(referenceIdField, undefined, false)).toMatchObject({
      ok: false,
      rule: 'REQUIRED',
    });
  });
});

describe('descriptionField', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['', null],
    ['   ', null],
    ['  Rent ', 'Rent'],
    ['x'.repeat(255), 'x'.repeat(255)],
  ])('normalises %j -> %j', (input, expected) => {
    expect(check(descriptionField, input, input !== undefined)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each([
    ['x'.repeat(256), 'TOO_LONG'],
    [123, 'INVALID_TYPE'],
    [{}, 'INVALID_TYPE'],
    ['a\nb', 'INVALID_CHARACTERS'],
  ])('rejects %j as %s', (input, rule) => {
    expect(check(descriptionField, input)).toMatchObject({ ok: false, rule });
  });
});

describe('uuidField', () => {
  const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  it('accepts and lowercases', () => {
    expect(check(uuidField, id.toUpperCase())).toEqual({ ok: true, value: id });
  });
  it.each(['abc', '123', `{${id}}`, `urn:uuid:${id}`, `${id}0`, '', 'not-a-uuid-at-all-really-no'])(
    'rejects %j as INVALID_UUID',
    (v) => {
      expect(check(uuidField, v)).toMatchObject({ ok: false, rule: 'INVALID_UUID' });
    },
  );
  it('rejects non-strings and missing', () => {
    expect(check(uuidField, 12345)).toMatchObject({ ok: false, rule: 'INVALID_TYPE' });
    expect(check(uuidField, undefined, false)).toMatchObject({ ok: false, rule: 'REQUIRED' });
    expect(check(uuidField, null)).toMatchObject({ ok: false, rule: 'REQUIRED' });
  });
});

describe('transactionTypeField', () => {
  it.each(['credit', 'debit'])('accepts %s', (v) => {
    expect(check(transactionTypeField, v)).toEqual({ ok: true, value: v });
  });
  it.each(['CREDIT', 'Credit', 'Debit', 'credit ', 'transfer', 'withdrawal', ''])(
    'rejects %j as INVALID_ENUM',
    (v) => {
      expect(check(transactionTypeField, v)).toMatchObject({ ok: false, rule: 'INVALID_ENUM' });
    },
  );
  it('rejects non-strings and missing', () => {
    expect(check(transactionTypeField, 1)).toMatchObject({ ok: false, rule: 'INVALID_ENUM' });
    expect(check(transactionTypeField, ['credit'])).toMatchObject({
      ok: false,
      rule: 'INVALID_TYPE',
    });
    expect(check(transactionTypeField, undefined, false)).toMatchObject({
      ok: false,
      rule: 'REQUIRED',
    });
    expect(check(transactionTypeField, null)).toMatchObject({ ok: false, rule: 'REQUIRED' });
  });
});

describe('strict objects', () => {
  it('reports every unknown key as UNKNOWN_FIELD', () => {
    const r = z
      .strictObject({ name: nameField })
      .safeParse({ name: 'Eve', balance: 500, id: 'x' }, { reportInput: true });
    expect(r.success).toBe(false);
    if (!r.success) {
      const d = mapIssues(r.error.issues, 'body');
      expect(d.map((x) => [x.field, x.rule])).toEqual([
        ['balance', 'UNKNOWN_FIELD'],
        ['id', 'UNKNOWN_FIELD'],
      ]);
    }
  });

  it('maps a non-object body to field "body"', () => {
    for (const bad of [[{ name: 'A' }], 'x', 42]) {
      const r = z.strictObject({ name: nameField }).safeParse(bad, { reportInput: true });
      expect(r.success).toBe(false);
      if (!r.success)
        expect(mapIssues(r.error.issues, 'body')[0]).toMatchObject({
          field: 'body',
          rule: 'INVALID_TYPE',
        });
    }
    const missing = z.strictObject({ name: nameField }).safeParse(undefined, { reportInput: true });
    if (!missing.success)
      expect(mapIssues(missing.error.issues, 'body')[0]).toMatchObject({
        field: 'body',
        rule: 'REQUIRED',
      });
  });

  it('reports all failing fields in one pass', () => {
    const r = z
      .strictObject({ type: transactionTypeField, amount: amountField, foo: z.never().optional() })
      .safeParse({ type: 'x', amount: 'abc', foo: 1 }, { reportInput: true });
    expect(r.success).toBe(false);
    if (!r.success)
      expect(
        mapIssues(r.error.issues, 'body')
          .map((d) => d.field)
          .sort(),
      ).toEqual(['amount', 'foo', 'type']);
  });
});
