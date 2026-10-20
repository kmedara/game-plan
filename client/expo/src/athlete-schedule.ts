/**
 * The athlete's calendar: every team's occurrences on one month.
 */

import type { ScheduleList, ScheduleOccurrence } from '@gameplan/types';

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
