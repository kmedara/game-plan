/**
 * Calendar sync: the caller's private feed link, and the public feed itself.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { requireUser } from '../../../lib/guards.js';
import { json, notFound } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import { buildFeed, getOrCreateFeed, rotateFeed, userForToken } from '../feed-store.js';
import { withScheduleErrors } from './errors.js';

/** Shape of a feed file name: the token and `.ics`. */
const FEED_FILE = /^([A-Za-z0-9_-]{16,64})\.ics$/u;

/** `GET /schedule/feed` — the caller's links, created on first use. */
export const handleGetFeed = route(
  'GET',
  '/schedule/feed',
  withScheduleErrors(),
  requireUser(),
  async ({ user }) => json(200, await getOrCreateFeed(user.userId)),
);

/** `POST /schedule/feed/rotate` — a new link; the old one stops working. */
export const handleRotateFeed = route(
  'POST',
  '/schedule/feed/rotate',
  withScheduleErrors(),
  requireUser(),
  async ({ user }) => json(200, await rotateFeed(user.userId)),
);

/**
 * `GET /schedule/feeds/:file` — the iCalendar feed for `<token>.ics`.
 *
 * Calendar apps cannot sign in, so the token in the URL is the only check.
 * An unknown token is `404`, the same as a malformed one. `?teams=a,b`
 * narrows the feed to some of the owner's teams.
 */
export const handleCalendarFeed = route(
  'GET',
  '/schedule/feeds/:file',
  withScheduleErrors(),
  async ({ file, event }): Promise<APIGatewayProxyStructuredResultV2> => {
    const token = FEED_FILE.exec(file)?.[1];
    if (token === undefined) return notFound();
    const userId = await userForToken(token);
    if (userId === undefined) return notFound();
    const teams = event.queryStringParameters?.teams
      ?.split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const body = await buildFeed(userId, new Date(), teams === undefined || teams.length === 0 ? undefined : new Set(teams));
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="gameplan.ics"',
        'cache-control': 'private, max-age=900',
      },
      body,
    };
  },
);
