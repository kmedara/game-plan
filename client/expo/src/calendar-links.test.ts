/**
 * Subscribe links carry the feed in the form each calendar app expects.
 */

import { subscribeUrl } from './calendar-links';

const feed = {
  url: 'https://gameplan.app/api/schedule/feeds/abc.ics',
  webcalUrl: 'webcal://gameplan.app/api/schedule/feeds/abc.ics',
};

describe('subscribeUrl', () => {
  it('passes the webcal link to Google and Apple and the https link to Outlook', () => {
    expect(subscribeUrl('google', feed)).toBe(
      'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fgameplan.app%2Fapi%2Fschedule%2Ffeeds%2Fabc.ics',
    );
    expect(subscribeUrl('apple', feed)).toBe(feed.webcalUrl);
    expect(subscribeUrl('outlook', feed)).toContain('url=https%3A%2F%2Fgameplan.app%2Fapi%2Fschedule%2Ffeeds%2Fabc.ics');
  });
});
