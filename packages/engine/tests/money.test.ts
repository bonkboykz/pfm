import { describe, it, expect } from 'vitest';
import { formatMoney, addCents, subtractCents, multiplyCents, sumCents } from '../src/math/money.js';

describe('formatMoney', () => {
  it('formats positive KZT amount', () => {
    expect(formatMoney(15000000)).toBe('150 000 ₸');
  });

  it('formats negative amount', () => {
    expect(formatMoney(-850000)).toBe('-8 500 ₸');
  });

  it('formats zero', () => {
    expect(formatMoney(0)).toBe('0 ₸');
  });

  it('formats small amount (truncates sub-tenge)', () => {
    expect(formatMoney(199)).toBe('1 ₸');
  });

  it('formats with USD symbol', () => {
    expect(formatMoney(100000, 'USD')).toBe('1 000 $');
  });

  it('formats with EUR symbol', () => {
    expect(formatMoney(5000, 'EUR')).toBe('50 €');
  });

  it('formats with RUB symbol', () => {
    expect(formatMoney(1000000, 'RUB')).toBe('10 000 ₽');
  });

  it('falls back to ISO code for unknown currency', () => {
    expect(formatMoney(50000, 'GBP')).toBe('500 GBP');
  });

  it('formats large amount with spaces', () => {
    expect(formatMoney(50000000)).toBe('500 000 ₸');
  });
});

describe('addCents', () => {
  it('adds two amounts', () => {
    expect(addCents(100, 200)).toBe(300);
  });

  it('adds multiple amounts', () => {
    expect(addCents(100, 200, 300, 400)).toBe(1000);
  });

  it('handles negatives', () => {
    expect(addCents(1000, -300)).toBe(700);
  });

  it('handles zero arguments', () => {
    expect(addCents()).toBe(0);
  });

  it('handles single argument', () => {
    expect(addCents(500)).toBe(500);
  });
});

describe('subtractCents', () => {
  it('subtracts b from a', () => {
    expect(subtractCents(1000, 300)).toBe(700);
  });

  it('returns negative when b > a', () => {
    expect(subtractCents(100, 500)).toBe(-400);
  });

  it('subtracts zero', () => {
    expect(subtractCents(500, 0)).toBe(500);
  });
});

describe('multiplyCents', () => {
  it('multiplies and rounds', () => {
    expect(multiplyCents(1000, 1.5)).toBe(1500);
  });

  it('rounds to nearest integer', () => {
    expect(multiplyCents(333, 1.5)).toBe(500);
  });

  it('handles zero factor', () => {
    expect(multiplyCents(1000, 0)).toBe(0);
  });

  it('handles negative factor', () => {
    expect(multiplyCents(1000, -1)).toBe(-1000);
  });
});

describe('sumCents', () => {
  it('sums array of amounts', () => {
    expect(sumCents([100, 200, 300])).toBe(600);
  });

  it('handles empty array', () => {
    expect(sumCents([])).toBe(0);
  });

  it('handles negatives in array', () => {
    expect(sumCents([1000, -300, -200])).toBe(500);
  });
});
