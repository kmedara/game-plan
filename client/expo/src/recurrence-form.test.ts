/**
 * Recurrence form mapping onto the stored rule.
 */

import { recurrenceFromForm } from './recurrence-form';

const base = {
  timeZone: 'UTC',
  dayKey: '2026-10-05',
  startMinutes: 18 * 60,
  byWeekDay: ['MO'],
  end: { kind: 'never' as const },
  interval: 1,
};

describe('recurrence form', () => {
  it('omits a rule when the event does not repeat', () => {
    expect(recurrenceFromForm({ ...base, frequency: 'once' })).toBeUndefined();
  });

  it('sends a weekly BYDAY set in weekday order', () => {
    expect(
      recurrenceFromForm({ ...base, frequency: 'WEEKLY', byWeekDay: ['FR', 'MO'] }),
    ).toEqual({ frequency: 'WEEKLY', interval: 1, byWeekDay: ['MO', 'FR'] });
  });

  it('keeps count and until exclusive', () => {
    expect(
      recurrenceFromForm({ ...base, frequency: 'DAILY', interval: 2, end: { kind: 'count', count: 8 } }),
    ).toEqual({ frequency: 'DAILY', interval: 2, count: 8 });
    expect(
      recurrenceFromForm({
        ...base,
        frequency: 'MONTHLY',
        end: { kind: 'until', dayKey: '2027-01-05' },
      }),
    ).toEqual({
      frequency: 'MONTHLY',
      interval: 1,
      until: '2027-01-05T18:00:00.000Z',
    });
  });

  it('rejects an end date before the start', () => {
    expect(() =>
      recurrenceFromForm({
        ...base,
        frequency: 'YEARLY',
        end: { kind: 'until', dayKey: '2026-10-04' },
      }),
    ).toThrow('invalid_until');
  });
});
