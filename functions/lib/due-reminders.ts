/**
 * When to remind people about something due on a calendar date. Dues and
 * waivers share the same schedule, so a parent hears about both the same way.
 */

/** Kind of due-date reminder; also the push wording. */
export type DueReminderKind = 'upcoming' | 'due' | 'overdue';

/**
 * Adds days to a `YYYY-MM-DD` date.
 *
 * @param date - The calendar date.
 * @param days - Days to add; may be negative.
 * @returns The shifted calendar date.
 */
export const addDays = (date: string, days: number): string => {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

/**
 * Three days before, on the due date, then weekly for four weeks. Dates
 * already past are dropped.
 *
 * @param dueDate - The due date.
 * @param today - Today's date, `YYYY-MM-DD`.
 * @returns Dates and reminder kinds, earliest first.
 */
export const reminderSchedule = (
  dueDate: string,
  today: string,
): { sendOn: string; kind: DueReminderKind }[] =>
  [
    { sendOn: addDays(dueDate, -3), kind: 'upcoming' as const },
    { sendOn: dueDate, kind: 'due' as const },
    ...[7, 14, 21, 28].map((days) => ({ sendOn: addDays(dueDate, days), kind: 'overdue' as const })),
  ].filter((entry) => entry.sendOn >= today);
