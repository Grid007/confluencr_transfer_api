import { describe, expect, it } from 'vitest';
import { fromMinor, lt, normalize, shortfall, toMinor } from './money.js';

describe('money', () => {
  it('round-trips minor units', () => {
    for (const v of ['0.00', '0.01', '1.00', '150.00', '9999999999999.99']) {
      expect(fromMinor(toMinor(v))).toBe(v);
    }
  });

  it('normalizes to two decimals', () => {
    expect(normalize('50')).toBe('50.00');
    expect(normalize('50.5')).toBe('50.50');
    expect(normalize('50.00')).toBe('50.00');
    expect(normalize('0')).toBe('0.00');
  });

  it('is exact where floats are not (0.1 + 0.2 === 0.3)', () => {
    expect(fromMinor(toMinor('0.10') + toMinor('0.20'))).toBe('0.30');
    expect(lt('0.30', fromMinor(toMinor('0.10') + toMinor('0.20')))).toBe(false);
  });

  it('compares exactly', () => {
    expect(lt('100.00', '100.01')).toBe(true);
    expect(lt('100.00', '100.00')).toBe(false);
    expect(lt('100.01', '100.00')).toBe(false);
  });

  it('computes shortfall', () => {
    expect(shortfall('100.00', '150.00')).toBe('50.00');
    expect(shortfall('100.00', '100.01')).toBe('0.01');
  });
});
