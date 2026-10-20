/**
 * The athlete's calendar: every team's occurrences on one month.
 */

import type { EventType, ScheduleList, ScheduleOccurrence } from '@gameplan/types';

/** One occurrence tagged with the team it belongs to. */
export type TeamOccurrence = ScheduleOccurrence & { teamId: string };

/**
 * The device zone, or UTC when the platform has not reported one.
 *
 * @param timeZone - A calendar time zone from the device, which may be missing.
 * @returns An IANA time zone id.
 */
export const deviceTimeZone = (timeZone: string | null | undefined): string =>
  timeZone != null && timeZone.length > 0 ? timeZone : 'UTC';

/**
 * Flattens each team's schedule into one list ordered by start time.
 *
 * @param lists - Loaded schedule windows. Each list carries its team id.
 * @returns Occurrences tagged with `teamId`.
 */
export const mergeSchedules = (
  lists: readonly Pick<ScheduleList, 'teamId' | 'occurrences'>[],
): TeamOccurrence[] =>
  lists
    .flatMap((list) => list.occurrences.map((item) => ({ ...item, teamId: list.teamId })))
    .sort((left, right) => {
      const byTime = left.startsAt.localeCompare(right.startsAt);
      if (byTime !== 0) return byTime;
      const byTeam = left.teamId.localeCompare(right.teamId);
      if (byTeam !== 0) return byTeam;
      return left.eventId.localeCompare(right.eventId);
    });

/** Teams and event types hidden on the calendar. Empty lists show everything. */
export type CalendarFilter = {
  hiddenTeamIds: readonly string[];
  hiddenEventTypes: readonly EventType[];
};

/** Nothing hidden. */
export const SHOW_ALL: CalendarFilter = { hiddenTeamIds: [], hiddenEventTypes: [] };

/**
 * Drops occurrences from hidden teams or of hidden event types.
 *
 * @param events - Merged occurrences.
 * @param filter - What to hide.
 * @returns The occurrences still shown, in the same order.
 */
export const filterOccurrences = (events: readonly TeamOccurrence[], filter: CalendarFilter): TeamOccurrence[] => {
  const teams = new Set(filter.hiddenTeamIds);
  const types = new Set<string>(filter.hiddenEventTypes);
  return events.filter((item) => !teams.has(item.teamId) && !types.has(item.eventType));
};

/**
 * Reads a stored filter, dropping anything that no longer parses.
 *
 * @param raw - The stored JSON, if any.
 * @returns The filter, or {@link SHOW_ALL}.
 */
export const parseCalendarFilter = (raw: string | undefined): CalendarFilter => {
  if (raw === undefined) return SHOW_ALL;
  try {
    const value = JSON.parse(raw) as { hiddenTeamIds?: unknown; hiddenEventTypes?: unknown };
    const strings = (list: unknown): string[] =>
      Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
    return {
      hiddenTeamIds: strings(value.hiddenTeamIds),
      hiddenEventTypes: strings(value.hiddenEventTypes).filter((type): type is EventType =>
        ['practice', 'game', 'meeting', 'other'].includes(type),
      ),
    };
  } catch {
    return SHOW_ALL;
  }
};
