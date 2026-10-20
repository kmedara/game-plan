/**
 * Merged schedule: team tags, order, and the athlete's day.
 */

import type { ScheduleOccurrence } from '@gameplan/types';
import { filterOccurrences, mergeSchedules, parseCalendarFilter, SHOW_ALL, type TeamOccurrence } from './athlete-schedule';
import { dayKeyInZone } from './schedule-calendar';

const occurrence = (eventId: string, startsAt: string): ScheduleOccurrence => ({
  eventId,
  eventType: 'practice',
  title: eventId,
  startsAt,
  recurring: false,
  rsvps: [],
});

describe('mergeSchedules', () => {
  it('tags each occurrence with its team and sorts by start', () => {
    const merged = mergeSchedules([
      { teamId: 'west', occurrences: [occurrence('late', '2026-01-15T20:00:00.000Z')] },
      {
        teamId: 'east',
        occurrences: [
          occurrence('early', '2026-01-15T03:30:00.000Z'),
          occurrence('mid', '2026-01-15T15:00:00.000Z'),
        ],
      },
    ]);

    expect(merged.map((item) => `${item.teamId}:${item.eventId}`)).toEqual([
      'east:early',
      'east:mid',
      'west:late',
    ]);
  });

  it('places an occurrence on the device day, not the team day', () => {
    const [item] = mergeSchedules([
      { teamId: 'east', occurrences: [occurrence('early', '2026-01-15T03:30:00.000Z')] },
    ]);
    expect(item).toBeDefined();
    expect(dayKeyInZone(new Date(item!.startsAt), 'America/Los_Angeles')).toBe('2026-01-14');
    expect(dayKeyInZone(new Date(item!.startsAt), 'Asia/Tokyo')).toBe('2026-01-15');
  });
});

describe('filterOccurrences', () => {
  const teamOccurrence = (teamId: string, eventType: 'practice' | 'game') =>
    ({ teamId, eventType, eventId: `${teamId}-${eventType}`, startsAt: '2026-10-20T00:00:00.000Z' }) as TeamOccurrence;
  const events = [teamOccurrence('a', 'practice'), teamOccurrence('a', 'game'), teamOccurrence('b', 'game')];

  it('shows everything when nothing is hidden', () => {
    expect(filterOccurrences(events, SHOW_ALL)).toHaveLength(3);
  });

  it('hides teams and event types together', () => {
    const shown = filterOccurrences(events, { hiddenTeamIds: ['b'], hiddenEventTypes: ['practice'] });
    expect(shown.map((item) => item.eventId)).toEqual(['a-game']);
  });
});

describe('parseCalendarFilter', () => {
  it('reads a stored filter and ignores junk', () => {
    expect(parseCalendarFilter('{"hiddenTeamIds":["t1",2],"hiddenEventTypes":["game","party"]}')).toEqual({
      hiddenTeamIds: ['t1'],
      hiddenEventTypes: ['game'],
    });
    expect(parseCalendarFilter('not json')).toEqual(SHOW_ALL);
    expect(parseCalendarFilter(undefined)).toEqual(SHOW_ALL);
  });
});
