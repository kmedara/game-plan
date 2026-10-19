/**
 * Typed amounts become minor units, and minor units read as money.
 */

import { formatMoney, parseAmountCents } from './money';

describe('parseAmountCents', () => {
  it('reads whole and decimal amounts', () => {
    expect(parseAmountCents('45')).toBe(4500);
    expect(parseAmountCents('45.5')).toBe(4550);
    expect(parseAmountCents('$45.05')).toBe(4505);
    expect(parseAmountCents(' 45,50 ')).toBe(4550);
  });

  it('rejects zero, negatives, extra decimals, and words', () => {
    expect(parseAmountCents('0')).toBeUndefined();
    expect(parseAmountCents('-5')).toBeUndefined();
    expect(parseAmountCents('4.555')).toBeUndefined();
    expect(parseAmountCents('ten')).toBeUndefined();
    expect(parseAmountCents('')).toBeUndefined();
  });
});

describe('formatMoney', () => {
  it('formats minor units in the given currency', () => {
    expect(formatMoney(4500, 'usd')).toBe('$45.00');
    expect(formatMoney(1999, 'eur', 'en')).toBe('€19.99');
  });
});
