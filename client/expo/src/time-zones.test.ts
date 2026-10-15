import { formatOffset, searchTimeZones, timeZoneLabel, timeZoneOffsetMinutes } from './time-zones';

describe('time zones', () => {
  const winter = new Date('2026-01-15T17:00:00Z');
  const summer = new Date('2026-07-15T16:00:00Z');

  it('formats offsets with hours and minutes', () => {
    expect(formatOffset(-300)).toBe('UTC-05:00');
    expect(formatOffset(330)).toBe('UTC+05:30');
    expect(formatOffset(0)).toBe('UTC+00:00');
  });

  it('uses daylight time when the instant is in summer', () => {
    expect(timeZoneOffsetMinutes('America/New_York', winter)).toBe(-300);
    expect(timeZoneOffsetMinutes('America/New_York', summer)).toBe(-240);
    expect(timeZoneLabel('America/New_York', winter)).toBe('America/New York (UTC-05:00)');
  });

  it('filters zones and shows the offset', () => {
    const matches = searchTimeZones('tokyo', winter);
    expect(matches.some((zone) => zone.id === 'Asia/Tokyo' && zone.label.includes('UTC+09:00'))).toBe(true);
  });
});
