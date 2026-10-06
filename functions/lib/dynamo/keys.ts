/**
 * Single-table key builders for the `gameplan` DynamoDB table.
 *
 * Every item uses `PK` + `SK`. One query loads a partition. A Global Secondary
 * Index (GSI) exists only when the lookup cannot start from that partition:
 * exact email, and the WebSocket connection id on `$disconnect`.
 */

/** Cognito `sub` — same value as `userId` on membership and profile rows. */
export type UserId = string;

/** Opaque team id. */
export type TeamId = string;

/** Opaque chat id. */
export type ChatId = string;

/** Invite code shared in a link. */
export type InviteCode = string;

/** Base table attribute names. */
export const TABLE_PK = 'PK' as const;
export const TABLE_SK = 'SK' as const;

/** Email GSI hash attribute on the user profile item. */
export const GSI_EMAIL = 'email' as const;

/** Connection GSI hash attribute on a socket connection item. */
export const GSI_CONNECTION_ID = 'connectionId' as const;

/** `USER#<userId>` — profile, memberships, devices, and socket connections. */
export const userPk = (userId: UserId): string => `USER#${userId}`;

/** Fixed sort key for the single profile row under a user partition. */
export const profileSk = (): string => 'PROFILE';

/** Sort key for a team membership under the user partition. */
export const userTeamSk = (teamId: TeamId): string => `TEAM#${teamId}`;

/** Sort-key prefix for every team membership under a user. */
export const USER_TEAM_SK_PREFIX = 'TEAM#' as const;

/** Sort key for a chat membership under the user partition. */
export const userChatSk = (chatId: ChatId): string => `CHAT#${chatId}`;

/** Sort-key prefix for every chat membership under a user. */
export const USER_CHAT_SK_PREFIX = 'CHAT#' as const;

/** Sort key for a push device token under the user partition. */
export const deviceSk = (deviceId: string): string => `DEVICE#${deviceId}`;

/** Sort-key prefix for every push device under a user. */
export const DEVICE_SK_PREFIX = 'DEVICE#' as const;

/** Sort key for a WebSocket connection under the user partition. */
export const connectionSk = (connectionId: string): string => `CONN#${connectionId}`;

/** Sort-key prefix for every socket connection under a user. */
export const CONNECTION_SK_PREFIX = 'CONN#' as const;

/**
 * How long a socket connection row stays before time-to-live removes it.
 *
 * Dropped phones leave a stale connection id; the row expires so fan-out does
 * not keep posting to a dead socket.
 */
export const CONNECTION_TTL_SECONDS = 2 * 60 * 60;

/** `TEAM#<teamId>` — team record, roles, roster, invites, events, and RSVPs. */
export const teamPk = (teamId: TeamId): string => `TEAM#${teamId}`;

/** Fixed sort key for the team metadata row (name, time zone, default chat). */
export const teamMetaSk = (): string => 'META';

/** Sort key for the permission list of one role on a team. */
export const rolePermissionsSk = (role: string): string => `ROLE#${role}`;

/** Sort-key prefix for every role-permission row on a team. */
export const ROLE_PERMISSIONS_SK_PREFIX = 'ROLE#' as const;

/** Sort key for a roster membership under the team partition. */
export const teamMemberSk = (userId: UserId): string => `MEMBER#${userId}`;

/** Sort-key prefix for every roster member on a team. */
export const TEAM_MEMBER_SK_PREFIX = 'MEMBER#' as const;

/** Sort key for an invite row under the team partition. */
export const teamInviteSk = (code: InviteCode): string => `INVITE#${code}`;

/** Sort-key prefix for every invite on a team. */
export const TEAM_INVITE_SK_PREFIX = 'INVITE#' as const;

/** Sort key for a join request under the team partition. */
export const joinRequestSk = (requestId: string): string => `JOIN#${requestId}`;

/** Sort-key prefix for every join request on a team. */
export const JOIN_REQUEST_SK_PREFIX = 'JOIN#' as const;

/** Sort key for a practice or game under the team partition. */
export const eventSk = (eventId: string): string => `EVT#${eventId}`;

/** Sort-key prefix for every event on a team. */
export const EVENT_SK_PREFIX = 'EVT#' as const;

/**
 * Sort key for a per-occurrence RSVP.
 *
 * Embedding the occurrence instant lets a month load as a bounded range query.
 */
export const rsvpSk = (occurrenceStartsAt: string, userId: UserId): string =>
  `RSVP#${occurrenceStartsAt}#${userId}`;

/** Sort-key prefix shared by every RSVP on a team. */
export const RSVP_SK_PREFIX = 'RSVP#' as const;

/**
 * Inclusive `SK BETWEEN` bounds for RSVPs whose occurrence falls in a window.
 *
 * `\uffff` is the largest code point, so the high bound captures every user on
 * the end instant.
 */
export const rsvpSkRange = (
  rangeStartIso: string,
  rangeEndIso: string,
): { lo: string; hi: string } => ({
  lo: `${RSVP_SK_PREFIX}${rangeStartIso}`,
  hi: `${RSVP_SK_PREFIX}${rangeEndIso}#\uffff`,
});

/** `CHAT#<chatId>` — chat record, members, and messages. */
export const chatPk = (chatId: ChatId): string => `CHAT#${chatId}`;

/** Fixed sort key for the chat metadata row. */
export const chatMetaSk = (): string => 'META';

/** Sort key for a chat member under the chat partition. */
export const chatMemberSk = (userId: UserId): string => `MEMBER#${userId}`;

/** Sort-key prefix for every member of a chat. */
export const CHAT_MEMBER_SK_PREFIX = 'MEMBER#' as const;

/**
 * Sort key for a message under the chat partition.
 *
 * Message history is a reverse query on this prefix with a page limit.
 */
export const messageSk = (createdAtIso: string, messageId: string): string =>
  `MSG#${createdAtIso}#${messageId}`;

/** Sort-key prefix shared by every message in a chat. */
export const MESSAGE_SK_PREFIX = 'MSG#' as const;

/**
 * `INVITE#<code>` — load an invite from the code in a shared link.
 *
 * The team partition also stores the invite for team-scoped listing; this
 * partition exists so redemption can start from the code alone.
 */
export const invitePk = (code: InviteCode): string => `INVITE#${code}`;

/** Fixed sort key for the invite lookup row. */
export const inviteMetaSk = (): string => 'META';

/**
 * `TEAM_DIR` — searchable team directory for join autocomplete.
 *
 * Sort keys are `NAME#<normalizedName>#<teamId>` so a prefix query can find
 * teams by typed name without a Global Secondary Index (GSI).
 */
export const teamDirectoryPk = (): string => 'TEAM_DIR';

/**
 * Builds the directory sort key for a team name.
 *
 * @param name - The display name (normalized to lower case in the key).
 * @param teamId - The team id (keeps names unique under the same prefix).
 * @returns The directory sort key.
 */
export const teamDirectorySk = (name: string, teamId: TeamId): string =>
  `NAME#${name.trim().toLowerCase()}#${teamId}`;

/** Sort-key prefix for every directory row (optionally narrowed by a typed query). */
export const teamDirectorySkPrefix = (namePrefix = ''): string =>
  namePrefix.trim().length === 0
    ? 'NAME#'
    : `NAME#${namePrefix.trim().toLowerCase()}`;
