/**
 * Links that subscribe a calendar app to the private GamePlan feed.
 */

import type { CalendarFeed } from '@gameplan/types';

/** Calendar apps the profile offers a button for. */
export type CalendarApp = 'google' | 'apple' | 'outlook';

/**
 * The link that opens a calendar app's subscribe screen with the feed filled in.
 *
 * Google takes the `webcal` link; Apple Calendar opens `webcal` itself;
 * Outlook takes the `https` link.
 *
 * @param app - The calendar app.
 * @param feed - The person's feed links.
 * @returns A URL to open.
 */
export const subscribeUrl = (app: CalendarApp, feed: CalendarFeed): string => {
  switch (app) {
    case 'google':
      return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.webcalUrl)}`;
    case 'apple':
      return feed.webcalUrl;
    case 'outlook':
      return `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed.url)}&name=GamePlan`;
  }
};
