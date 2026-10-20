/**
 * Private calendar feed links and what they contain.
 *
 * `USER#<userId>` / `FEED` holds the person's token; `FEED#<token>` / `META`
 * maps it back. The token is the only secret in the URL, like a share link,
 * so calendar apps can fetch it without signing in. Rotating it breaks the
 * old link.
 */

import { randomBytes } from 'node:crypto';
import type { CalendarFeed } from '@gameplan/types';
import { listChildIds } from '../../lib/guardians.js';
import {
  TABLE_PK,
  TABLE_SK,
  USER_TEAM_SK_PREFIX,
  deleteItem,
  feedMetaSk,
  feedPk,
  getItem,
  putItem,
  queryBySkPrefix,
  userFeedSk,
  userPk,
} from '../../lib/dynamo/index.js';
import { buildCalendar, type FeedOccurrence } from './ical.js';
import { listOccurrences, requireTeam } from './schedule-store.js';

/** Days of history a feed keeps, so last week's games stay visible. */
const PAST_DAYS = 30;

/** Days ahead a feed covers. */
const FUTURE_DAYS = 180;

/** One schedule read per chunk; `listOccurrences` allows about three months. */
const CHUNK_DAYS = 90;

/** Teams one feed reads at most, which bounds the cost of one fetch. */
const MAX_FEED_TEAMS = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stored token row on the person's partition. */
type UserFeedItem = { token: string; createdAt: string };

/**
 * A fresh unguessable token (192 bits).
 *
 * @returns URL-safe text.
 */
const newToken = (): string => randomBytes(24).toString('base64url');

/**
 * The public links for a token.
 *
 * @param token - The feed token.
 * @returns The `https` and `webcal` URLs.
 */
export const feedLinks = (token: string): CalendarFeed => {
  const origin = (process.env.CLIENT_ORIGIN ?? 'http://localhost:4200').replace(/\/+$/u, '');
  const url = `${origin}/api/schedule/feeds/${token}.ics`;
  return { url, webcalUrl: url.replace(/^https?:/u, 'webcal:') };
};

/**
 * Stores a new token for a person and forgets the old one.
 *
 * @param userId - The person.
 * @param previous - Their current token, if any.
 * @returns The new token.
 */
const issueToken = async (userId: string, previous?: string): Promise<string> => {
  const token = newToken();
  await putItem({ [TABLE_PK]: feedPk(token), [TABLE_SK]: feedMetaSk(), token, userId });
  await putItem({ [TABLE_PK]: userPk(userId), [TABLE_SK]: userFeedSk(), token, createdAt: new Date().toISOString() });
  if (previous !== undefined) await deleteItem(feedPk(previous), feedMetaSk());
  return token;
};

/**
 * A person's feed links, creating the token on first use.
 *
 * @param userId - The person.
 * @returns Their links.
 */
export const getOrCreateFeed = async (userId: string): Promise<CalendarFeed> => {
  const existing = await getItem<UserFeedItem>(userPk(userId), userFeedSk());
  return feedLinks(existing?.token ?? (await issueToken(userId)));
};

/**
 * Replaces a person's token, so the old link stops working.
 *
 * @param userId - The person.
 * @returns Their new links.
 */
export const rotateFeed = async (userId: string): Promise<CalendarFeed> => {
  const existing = await getItem<UserFeedItem>(userPk(userId), userFeedSk());
  return feedLinks(await issueToken(userId, existing?.token));
};

/**
 * The person a token belongs to.
 *
 * @param token - From the URL.
 * @returns The user id, or `undefined` for an unknown or rotated token.
 */
export const userForToken = async (token: string): Promise<string | undefined> =>
  (await getItem<{ userId?: string }>(feedPk(token), feedMetaSk()))?.userId;

/**
 * Team ids a person's calendar shows: their own and their children's.
 *
 * @param userId - The person.
 * @returns Distinct team ids, at most {@link MAX_FEED_TEAMS}.
 */
const feedTeamIds = async (userId: string): Promise<string[]> => {
  const people = [userId, ...(await listChildIds(userId))];
  const rows = (await Promise.all(people.map((id) => queryBySkPrefix<{ teamId?: string }>(userPk(id), USER_TEAM_SK_PREFIX)))).flat();
  const ids = rows.flatMap((row) => (typeof row.teamId === 'string' ? [row.teamId] : []));
  return [...new Set(ids)].slice(0, MAX_FEED_TEAMS);
};

/**
 * Builds a person's feed.
 *
 * @param userId - The feed owner.
 * @param now - The clock.
 * @param onlyTeamIds - Optional subset of their teams.
 * @returns The `text/calendar` body.
 */
export const buildFeed = async (userId: string, now: Date, onlyTeamIds?: ReadonlySet<string>): Promise<string> => {
  const teamIds = (await feedTeamIds(userId)).filter((id) => onlyTeamIds === undefined || onlyTeamIds.has(id));
  const start = now.getTime() - PAST_DAYS * DAY_MS;
  const end = now.getTime() + FUTURE_DAYS * DAY_MS;
  const occurrences: FeedOccurrence[] = [];
  for (const teamId of teamIds) {
    const team = await requireTeam(teamId).catch(() => undefined);
    if (team === undefined) continue;
    for (let from = start; from < end; from += CHUNK_DAYS * DAY_MS) {
      const to = Math.min(from + CHUNK_DAYS * DAY_MS - 1, end);
      const list = await listOccurrences(teamId, new Date(from).toISOString(), new Date(to).toISOString());
      for (const item of list.occurrences) occurrences.push({ ...item, teamId, teamName: team.name });
    }
  }
  occurrences.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  return buildCalendar({ name: 'GamePlan', occurrences, now });
};
