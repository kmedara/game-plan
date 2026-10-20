/**
 * Merged schedule: team tags, order, and the athlete's day.
 */

import type { ScheduleOccurrence } from '@gameplan/types';
import { mergeSchedules } from './athlete-schedule';
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
