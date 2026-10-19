/**
 * Amounts in minor units (cents) to and from what people type and read.
 */

/**
 * Formats minor units as a currency amount.
 *
 * @param cents - Amount in minor units.
 * @param currency - ISO currency code, any case.
 * @param locale - Display language, such as `en` or `es`.
 * @returns Text such as `$45.00`.
 */
export const formatMoney = (cents: number, currency: string, locale = 'en'): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

/**
 * Reads a typed amount such as `45`, `45.5`, `$45.50`, or `45,50`.
 *
 * @param text - What the person typed.
 * @returns Whole minor units, or `undefined` when it is not a positive amount with at most two decimals.
 */
export const parseAmountCents = (text: string): number | undefined => {
  const cleaned = text.replace(/[\s$€£]/gu, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/u.test(cleaned)) return undefined;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents > 0 ? cents : undefined;
};
