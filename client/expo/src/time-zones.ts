/**
 * IANA time zone search for the team settings picker.
 */

export type TimeZoneChoice = {
  id: string;
  label: string;
};

const ZONE_ID = /^[A-Za-z_]+(?:\/[A-Za-z_]+)+$/u;

/**
 * Minutes east of UTC for an instant in a time zone.
 *
 * @param timeZone - An IANA time zone id.
 * @param at - The instant used to pick standard time or daylight time.
 * @returns The offset in minutes.
 */
export const timeZoneOffsetMinutes = (timeZone: string, at: Date): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/u.exec(raw);
  if (match === null) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
};

/**
 * Formats an offset as `UTC±HH:MM`.
 *
 * @param minutes - Minutes east of UTC.
 * @returns The offset label.
 */
export const formatOffset = (minutes: number): string => {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const mins = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${mins}`;
};

/**
 * Builds the picker label for one zone at an instant.
 *
 * @param timeZone - An IANA time zone id.
 * @param at - The instant used for the offset.
 * @returns The zone name and its current offset.
 */
export const timeZoneLabel = (timeZone: string, at: Date = new Date()): string => {
  const name = timeZone.replaceAll('_', ' ');
  return `${name} (${formatOffset(timeZoneOffsetMinutes(timeZone, at))})`;
};

const knownZones = (): string[] => {
  if (typeof Intl.supportedValuesOf !== 'function') return [];
  return Intl.supportedValuesOf('timeZone').filter((zone) => ZONE_ID.test(zone));
};

/**
 * Filters IANA zones by a typed query.
 *
 * @param query - Text matched against the zone id.
 * @param at - The instant used for each offset.
 * @param limit - Maximum choices to return.
 * @returns Matching zones, earliest offset first.
 */
export const searchTimeZones = (
  query: string,
  at: Date = new Date(),
  limit = 8,
): TimeZoneChoice[] => {
  const needle = query.trim().toLowerCase().replaceAll(' ', '_');
  return knownZones()
    .filter((zone) => needle.length === 0 || zone.toLowerCase().includes(needle))
    .map((id) => ({ id, offset: timeZoneOffsetMinutes(id, at) }))
    .sort((left, right) => left.offset - right.offset || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map(({ id }) => ({ id, label: timeZoneLabel(id, at) }));
};
