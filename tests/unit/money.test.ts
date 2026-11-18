import { describe, expect, it } from 'vitest';
import { assertPaisa, paisaToRupeeString, parseRupees } from '../../src/core/money.js';
import { ValidationError } from '../../src/index.js';

describe('paisaToRupeeString', () => {
  it.each([
    [11000, '110'],
    [11050, '110.50'],
    [11005, '110.05'],
    [1, '0.01'],
    [0, '0'],
    [100_000_000, '1000000'],
  ])('%i paisa → "%s"', (paisa, expected) => {
    expect(paisaToRupeeString(paisa)).toBe(expected);
  });

  it('rejects floats', () => {
    expect(() => paisaToRupeeString(10.5)).toThrow(ValidationError);
  });
});

describe('parseRupees', () => {
  it.each([
    ['1,000.0', 100_000],
    ['110', 11_000],
    ['110.5', 11_050],
    ['110.50', 11_050],
    ['0.01', 1],
    [' 1,10,000.00 ', 11_000_000],
    [100.0, 10_000],
    [1.005, 101],
  ])('%s → %i paisa', (input, expected) => {
    expect(parseRupees(input)).toBe(expected);
  });

  it.each(['', 'abc', '-10', '1e3', null, undefined, {}])('rejects %s', (input) => {
    expect(() => parseRupees(input)).toThrow(ValidationError);
  });
});

describe('assertPaisa', () => {
  it.each([0, -1, 1.5, Number.NaN, Infinity, '100', 2 ** 60])('rejects %s', (value) => {
    expect(() => assertPaisa(value)).toThrow(ValidationError);
  });

  it('allows zero when asked', () => {
    expect(assertPaisa(0, 'tax', { allowZero: true })).toBe(0);
  });
});
