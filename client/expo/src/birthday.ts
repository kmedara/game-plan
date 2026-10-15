/**
 * Calendar-date helpers for the birthday picker. Values stay `YYYY-MM-DD`.
 */

/** Local calendar date as `YYYY-MM-DD`. */
export const toIsoDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Parses `YYYY-MM-DD` as a local date. Invalid input falls back to today. */
export const parseIsoDate = (value: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

/** Long local label such as "March 14, 2008". */
export const formatBirthday = (value: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(parseIsoDate(value));
