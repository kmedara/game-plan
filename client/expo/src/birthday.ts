/**
 * Calendar-date helpers for the birthday fields. Values stay `YYYY-MM-DD`.
 */

/** One box in the birthday row. */
export type BirthdayPart = 'month' | 'day' | 'year';

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

/** Field order for a locale, such as month-day-year in `en-US`. */
export const birthdayPartOrder = (locale: string): BirthdayPart[] => {
  const order = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  })
    .formatToParts(new Date(2000, 11, 31))
    .flatMap((part): BirthdayPart[] =>
      part.type === 'month' || part.type === 'day' || part.type === 'year' ? [part.type] : [],
    );
  return order.length === 3 ? order : ['month', 'day', 'year'];
};

/**
 * Builds `YYYY-MM-DD` from the three boxes.
 *
 * Returns undefined while a box is empty, incomplete, or not a real past date.
 */
export const composeBirthday = (month: string, day: string, year: string, today = new Date()): string | undefined => {
  if (!/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year)) return undefined;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const yearNumber = Number(year);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || yearNumber < 1900) return undefined;
  const date = new Date(yearNumber, monthNumber - 1, dayNumber);
  if (date.getFullYear() !== yearNumber || date.getMonth() !== monthNumber - 1 || date.getDate() !== dayNumber) {
    return undefined;
  }
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (date.getTime() > todayDate.getTime()) return undefined;
  return toIsoDate(date);
};

/** Splits `YYYY-MM-DD` into the three boxes. Missing or invalid input is empty. */
export const splitBirthday = (value: string): Record<BirthdayPart, string> => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return { month: '', day: '', year: '' };
  return { year: match[1] ?? '', month: String(Number(match[2])), day: String(Number(match[3])) };
};
