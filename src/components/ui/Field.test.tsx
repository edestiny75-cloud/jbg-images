import { describe, expect, it } from 'vitest';
import { cleanMoney, moneyText, parseMoney } from './Field';

describe('cleanMoney', () => {
  it('keeps a decimal point mid-typing', () => {
    // The bug this replaces: Number("12.") is 12, so the dot vanished as it was typed.
    expect(cleanMoney('12.')).toBe('12.');
  });

  it('strips currency symbols and letters', () => {
    expect(cleanMoney('$1,299.50usd')).toBe('1299.50');
  });

  it('allows only one decimal point', () => {
    expect(cleanMoney('1.2.3')).toBe('1.23');
  });

  it('truncates beyond two decimals', () => {
    expect(cleanMoney('9.999')).toBe('9.99');
  });

  it('passes an empty string through', () => {
    expect(cleanMoney('')).toBe('');
  });
});

describe('parseMoney', () => {
  it('returns null for blank input', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
  });

  it('parses a half-typed decimal as its numeric value', () => {
    expect(parseMoney('12.')).toBe(12);
  });

  it('parses a leading-dot value', () => {
    expect(parseMoney('.5')).toBe(0.5);
  });

  it('returns null for something unusable', () => {
    expect(parseMoney('.')).toBeNull();
  });

  it('round-trips through moneyText', () => {
    expect(parseMoney(moneyText(9.99))).toBe(9.99);
    expect(parseMoney(moneyText(null))).toBeNull();
  });
});
