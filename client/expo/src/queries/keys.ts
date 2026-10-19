/**
 * Every query key in one place, so invalidation and cache writes agree on shape.
 *
 * Keys start with a kind, then the ids that scope it. Invalidating a prefix such as
 * `['schedule', teamId]` reaches every month loaded for that team.
 */

import type { PresignDownloadQuery } from '@gameplan/types';

export type DownloadContext = Pick<PresignDownloadQuery, 'chatId' | 'userId' | 'teamId'>;

export const queryKeys = {
  me: ['me'] as const,
  teams: ['teams'] as const,
  team: (teamId: string) => ['teams', teamId] as const,
  members: (teamId: string) => ['members', teamId] as const,
  member: (teamId: string, userId: string) => ['member', teamId, userId] as const,
  permissions: (teamId: string) => ['permissions', teamId] as const,
  invites: (teamId: string) => ['invites', teamId] as const,
  joinRequests: (teamId: string) => ['joinRequests', teamId] as const,
  teamSchedule: (teamId: string) => ['schedule', teamId] as const,
  schedule: (teamId: string, from: string, to: string) => ['schedule', teamId, from, to] as const,
  fixtures: (teamId: string) => ['fixtures', teamId] as const,
  event: (teamId: string, eventId: string) => ['event', teamId, eventId] as const,
  lineup: (teamId: string, eventId: string, occurrenceStartsAt: string) =>
    ['lineup', teamId, eventId, occurrenceStartsAt] as const,
  carpool: (teamId: string, eventId: string, occurrenceStartsAt: string) =>
    ['carpool', teamId, eventId, occurrenceStartsAt] as const,
  chats: ['chats'] as const,
  messages: (chatId: string) => ['messages', chatId] as const,
  download: (key: string, context: DownloadContext) => ['download', key, context] as const,
  invite: (code: string) => ['invite', code] as const,
  directory: (query: string) => ['directory', query] as const,
  paymentAccount: (teamId: string) => ['paymentAccount', teamId] as const,
  charges: (teamId: string) => ['charges', teamId] as const,
  charge: (teamId: string, chargeId: string) => ['charge', teamId, chargeId] as const,
  myDues: ['myDues'] as const,
};

/** Mutation keys for writes that may wait for the network and resume after a relaunch. */
export const mutationKeys = {
  rsvp: ['rsvp'] as const,
  carpoolOffer: ['carpoolOffer'] as const,
  carpoolClaim: ['carpoolClaim'] as const,
  lineup: ['lineup'] as const,
};

/** Mutation kinds written to device storage while paused offline. */
export const PERSISTED_MUTATION_KINDS: ReadonlySet<string> = new Set([
  'rsvp',
  'carpoolOffer',
  'carpoolClaim',
  'lineup',
]);

/**
 * Query kinds written to device storage.
 *
 * Presigned download URLs, directory pages, invite previews, and message history
 * are left out: they expire, page, or are chat content. Payment status is left
 * out too, so nobody sees a stale "unpaid" and pays twice.
 */
export const PERSISTED_QUERY_KINDS: ReadonlySet<string> = new Set([
  'me',
  'teams',
  'members',
  'member',
  'permissions',
  'invites',
  'joinRequests',
  'schedule',
  'event',
  'lineup',
  'carpool',
  'chats',
]);
