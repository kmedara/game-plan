/**
 * Event windows from a wall clock and an end choice.
 */

import { eventWindow } from './event-window';

describe('event window', () => {
  it('omits the end when none is chosen', () => {
    const window = eventWindow('America/New_York', '2026-10-05', 18 * 60, { kind: 'none' });
    expect(window.startsAt).toBe('2026-10-05T22:00:00.000Z');
    expect(window.endsAt).toBeUndefined();
  });

  it('adds a preset duration on the same day', () => {
    const window = eventWindow('America/New_York', '2026-10-05', 18 * 60, { kind: 'minutes', minutes: 90 });
    expect(window.endsAt).toBe('2026-10-05T23:30:00.000Z');
    expect(window.durationMinutes).toBe(90);
    expect(window.nextDay).toBe(false);
  });

  it('rolls a late duration onto the next civil day', () => {
    const window = eventWindow('UTC', '2026-10-05', 23 * 60, { kind: 'minutes', minutes: 90 });
    expect(window.startsAt).toBe('2026-10-05T23:00:00.000Z');
    expect(window.endsAt).toBe('2026-10-06T00:30:00.000Z');
    expect(window.nextDay).toBe(true);
  });

  it('treats a custom clock earlier than the start as the next day', () => {
    const window = eventWindow('UTC', '2026-10-05', 22 * 60, { kind: 'clock', minutes: 30 });
    expect(window.endsAt).toBe('2026-10-06T00:30:00.000Z');
    expect(window.nextDay).toBe(true);
    expect(window.durationMinutes).toBe(150);
  });
});
