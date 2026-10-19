/**
 * The notification banner shows only while no choice is recorded and no snooze applies.
 */

import { NOTIFICATION_SNOOZE_MS, shouldOfferNotifications } from './notification-prompt';

describe('shouldOfferNotifications', () => {
  const now = 1_000_000;

  it('offers when no choice is recorded or the site must be installed first', () => {
    expect(shouldOfferNotifications('prompt', undefined, now)).toBe(true);
    expect(shouldOfferNotifications('needs-install', undefined, now)).toBe(true);
  });

  it('stays hidden once allowed, blocked, or unsupported', () => {
    expect(shouldOfferNotifications('granted', undefined, now)).toBe(false);
    expect(shouldOfferNotifications('denied', undefined, now)).toBe(false);
    expect(shouldOfferNotifications('unsupported', undefined, now)).toBe(false);
  });

  it('waits out a "Not now" snooze, then offers again', () => {
    const until = String(now + NOTIFICATION_SNOOZE_MS);
    expect(shouldOfferNotifications('prompt', until, now)).toBe(false);
    expect(shouldOfferNotifications('prompt', until, now + NOTIFICATION_SNOOZE_MS + 1)).toBe(true);
  });

  it('ignores an unreadable stored value', () => {
    expect(shouldOfferNotifications('prompt', 'soon', now)).toBe(true);
  });
});
