/**
 * Writes an iCalendar (RFC 5545) feed from expanded occurrences.
 *
 * Each date is its own `VEVENT` with a UTC start, not a repeat rule. Calendar
 * apps disagree on repeat rules, exceptions, and time zones; single events
 * with stable UIDs show the same everywhere, and a cancelled or moved date
 * simply changes in the next fetch.
 */

import type { ScheduleOccurrence } from '@gameplan/types';

/** One occurrence and the team it belongs to. */
export type FeedOccurrence = ScheduleOccurrence & { teamId: string; teamName: string };

/** Length used when an event has no end, so calendars do not show a zero-minute block. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/**
 * Escapes a text value: backslash, semicolon, comma, and line breaks.
 *
 * @param value - Plain text.
 * @returns The escaped value.
 */
export const escapeText = (value: string): string =>
  value.replace(/\\/gu, '\\\\').replace(/;/gu, '\\;').replace(/,/gu, '\\,').replace(/\r?\n/gu, '\\n');

/**
 * Folds a content line at 75 octets, continuing with a leading space.
 *
 * Cuts never split a UTF-8 character.
 *
 * @param line - One unfolded line.
 * @returns The folded line, joined with CRLF.
 */
export const foldLine = (line: string): string => {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
};

/**
 * An instant in iCalendar UTC form, such as `20261020T020000Z`.
 *
 * @param iso - An ISO instant.
 * @returns The basic-format UTC date-time.
 */
export const icalDate = (iso: string): string =>
  new Date(iso).toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');

/**
 * The summary line: team name, title, and the opponent for a game.
 *
 * @param item - The occurrence.
 * @returns Plain text.
 */
const summaryOf = (item: FeedOccurrence): string => {
  const opponent =
    item.opponentName === undefined ? '' : ` ${item.side === 'away' ? '@' : 'vs'} ${item.opponentName}`;
  return `${item.teamName}: ${item.title}${opponent}`;
};

/**
 * Builds the feed body.
 *
 * @param input - Calendar name, the occurrences, and the clock for `DTSTAMP`.
 * @returns The `text/calendar` body with CRLF line endings.
 */
export const buildCalendar = (input: { name: string; occurrences: readonly FeedOccurrence[]; now: Date }): string => {
  const stamp = icalDate(input.now.toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GamePlan//Team schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(input.name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const item of input.occurrences) {
    const end = item.endsAt ?? new Date(new Date(item.startsAt).getTime() + DEFAULT_DURATION_MS).toISOString();
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.teamId}-${item.eventId}-${icalDate(item.startsAt)}@gameplan`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icalDate(item.startsAt)}`,
      `DTEND:${icalDate(end)}`,
      `SUMMARY:${escapeText(summaryOf(item))}`,
      `CATEGORIES:${escapeText(item.eventType)}`,
    );
    if (item.location !== undefined) lines.push(`LOCATION:${escapeText(item.location)}`);
    if (item.latitude !== undefined && item.longitude !== undefined) {
      lines.push(`GEO:${item.latitude};${item.longitude}`);
    }
    if (item.notes !== undefined) lines.push(`DESCRIPTION:${escapeText(item.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
};
