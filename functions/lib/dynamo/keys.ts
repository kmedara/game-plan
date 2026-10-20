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

/** Sort key for an adult linked as a minor's guardian. */
export const guardianSk = (adultId: UserId): string => `GUARDIAN#${adultId}`;

/** Sort-key prefix for every guardian of one minor. */
export const GUARDIAN_SK_PREFIX = 'GUARDIAN#' as const;

/** Sort key for a minor linked from the guardian's partition. */
export const childSk = (minorId: UserId): string => `CHILD#${minorId}`;

/** Sort-key prefix for every child of one guardian. */
export const CHILD_SK_PREFIX = 'CHILD#' as const;

/** Pending guardian invite under the minor's partition. */
export const guardianInviteSk = (inviteId: string): string => `GUARDIAN_INVITE#${inviteId}`;

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
 * Dropped phones leave a stale connection id. Fan-out deletes the row when a
 * post reports that connection gone. This expiry covers a row that never
 * receives another post.
 */
export const CONNECTION_TTL_SECONDS = 2 * 60 * 60;

/**
 * How long a socket connect ticket stays before time-to-live removes it.
 *
 * The authorizer deletes the row on use. This only cleans a ticket that was
 * issued and never redeemed.
 */
export const SOCKET_TICKET_TTL_SECONDS = 60;

/**
 * `TICKET#<id>` — one-time WebSocket connect ticket.
 *
 * The authorizer only has the ticket, so the lookup starts at this partition.
 */
export const ticketPk = (ticketId: string): string => `TICKET#${ticketId}`;

/** Fixed sort key for a socket connect ticket. */
export const ticketSk = (): string => 'TICKET';

/**
 * How long a native OAuth handoff code stays before time-to-live removes it.
 *
 * The exchange route deletes the row on use. This only cleans a code that was
 * issued and never redeemed.
 */
export const OAUTH_HANDOFF_TTL_SECONDS = 60;

/**
 * `HANDOFF#<code>` — one-time native OAuth refresh handoff.
 *
 * The app only has the code, so the lookup starts at this partition.
 */
export const handoffPk = (code: string): string => `HANDOFF#${code}`;

/** Fixed sort key for a native OAuth handoff. */
export const handoffSk = (): string => 'HANDOFF';

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

/** Sort key for the one invite row of a role under the team partition. */
export const teamInviteSk = (role: string): string => `INVITE#${role}`;

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
 * Occurrence-first so a month load stays a bounded range query. `eventId` is
 * required so two events that share a start instant do not collide.
 */
export const rsvpSk = (
  occurrenceStartsAt: string,
  eventId: string,
  userId: UserId,
): string => `RSVP#${occurrenceStartsAt}#${eventId}#${userId}`;

/**
 * Pre-eventId RSVP sort key. Kept so upserts can delete colliding legacy rows.
 *
 * @param occurrenceStartsAt - Occurrence instant ISO string.
 * @param userId - The RSVP owner.
 * @returns The legacy sort key.
 */
export const rsvpSkLegacy = (occurrenceStartsAt: string, userId: UserId): string =>
  `RSVP#${occurrenceStartsAt}#${userId}`;

/** Sort-key prefix shared by every RSVP on a team. */
export const RSVP_SK_PREFIX = 'RSVP#' as const;

/**
 * Sort key for one occurrence lineup.
 *
 * Occurrence-first, matching RSVPs, so two events that share a start instant do not collide.
 */
export const lineupSk = (occurrenceStartsAt: string, eventId: string): string =>
  `LINEUP#${occurrenceStartsAt}#${eventId}`;

/** Sort-key prefix shared by every lineup on a team. */
export const LINEUP_SK_PREFIX = 'LINEUP#' as const;

/**
 * Sort key for rides on one occurrence.
 *
 * Occurrence-first, matching lineups, so two events that share a start instant do not collide.
 */
export const carpoolSk = (occurrenceStartsAt: string, eventId: string): string =>
  `CARPOOL#${occurrenceStartsAt}#${eventId}`;

/** Volunteer sign-up slots for one occurrence. */
export const signupsSk = (occurrenceStartsAt: string, eventId: string): string =>
  `SIGNUPS#${occurrenceStartsAt}#${eventId}`;

/** Sort-key prefix for every carpool row. */
export const CARPOOL_SK_PREFIX = 'CARPOOL#' as const;

/** `FIXTURE#<fixtureId>` — one shared game. */
export const fixturePk = (fixtureId: string): string => `FIXTURE#${fixtureId}`;

/** Fixed sort key for the fixture metadata row. */
export const fixtureMetaSk = (): string => 'META';

/** Sort key for a team's link to a fixture, under the team partition. */
export const fixtureLinkSk = (fixtureId: string): string => `FIXTURE#${fixtureId}`;

/** Sort-key prefix for every fixture link on a team. */
export const FIXTURE_LINK_SK_PREFIX = 'FIXTURE#' as const;

/** Sort key for an incoming fixture proposal, under the invitee team. */
export const fixtureInviteSk = (fixtureId: string): string => `FIXTURE_INVITE#${fixtureId}`;

/** Sort-key prefix for every incoming fixture proposal on a team. */
export const FIXTURE_INVITE_SK_PREFIX = 'FIXTURE_INVITE#' as const;

/** Partition that holds due reminder rows for every team. */
export const REMINDERS_PK = 'REMINDERS' as const;

/**
 * One reminder for one occurrence, ordered by the instant it is due.
 *
 * `slot` names the reminder time, such as `evening18` or `before60`.
 */
export const reminderSk = (
  dueAt: string,
  eventId: string,
  occurrenceStartsAt: string,
  slot: string,
): string => `REMINDER#${dueAt}#${eventId}#${occurrenceStartsAt}#${slot}`;

/** `USER#<userId>` / `PREFS` — settings that follow the account. */
export const prefsSk = (): string => 'PREFS';

/** `USER#<userId>` / `MEDICAL` — emergency and medical info. */
export const medicalSk = (): string => 'MEDICAL';

/** One staff read of a member's emergency info, on the team partition. */
export const medicalReadSk = (at: string, viewerId: UserId, memberId: UserId): string =>
  `MEDREAD#${at}#${viewerId}#${memberId}`;

/** Sort-key prefix for the team's emergency-info read log. */
export const MEDICAL_READ_SK_PREFIX = 'MEDREAD#' as const;

/** `USER#<userId>` / `FEED` — the person's calendar feed token. */
export const userFeedSk = (): string => 'FEED';

/** `FEED#<token>` — which person a calendar feed URL belongs to. */
export const feedPk = (token: string): string => `FEED#${token}`;

/** The single row under {@link feedPk}. */
export const feedMetaSk = (): string => 'META';

/** Sort-key prefix for every reminder row. */
export const REMINDER_SK_PREFIX = 'REMINDER#' as const;

/** Team row holding the paid plan (tier, status, period end). */
export const planSk = (): string => 'PLAN';

/** Row holding the Stripe Billing customer and subscription ids for a team. */
export const billingSk = (): string => 'BILLING';

/** `STRIPE_CUSTOMER#<customerId>` — which team a Billing customer pays for. */
export const stripeCustomerPk = (customerId: string): string => `STRIPE_CUSTOMER#${customerId}`;

/** Team row holding the connected Stripe account and its readiness flags. */
export const teamStripeSk = (): string => 'STRIPE';

/** One charge on a team: what staff asked members to pay. */
export const chargeSk = (chargeId: string): string => `CHARGE#${chargeId}`;

/** Sort-key prefix for every charge on a team. */
export const CHARGE_SK_PREFIX = 'CHARGE#' as const;

/** One member's share of a charge, on the team partition. */
export const dueSk = (chargeId: string, memberId: UserId): string => `DUE#${chargeId}#${memberId}`;

/** Sort-key prefix for every member due on one charge. */
export const dueSkPrefix = (chargeId: string): string => `DUE#${chargeId}#`;

/** Copy of a due on the member's partition, for the "my dues" list. */
export const userDueSk = (teamId: TeamId, chargeId: string): string => `DUE#${teamId}#${chargeId}`;

/** Sort-key prefix for every due copy on a user. */
export const USER_DUE_SK_PREFIX = 'DUE#' as const;

/** `STRIPE_ACCOUNT#<accountId>` — which team a connected account belongs to. */
export const stripeAccountPk = (accountId: string): string => `STRIPE_ACCOUNT#${accountId}`;

/** The single row under {@link stripeAccountPk}. */
export const stripeAccountSk = (): string => 'TEAM';

/** Partition that holds dated dues-reminder rows for every team. */
export const PAYMENT_REMINDERS_PK = 'PAYMENT_REMINDERS' as const;

/** Kind of dues reminder; also the push wording. */
export type PaymentReminderKind = 'upcoming' | 'due' | 'overdue';

/** One dues reminder, ordered by the calendar date it is due. */
export const paymentReminderSk = (
  sendOn: string,
  teamId: TeamId,
  chargeId: string,
  kind: PaymentReminderKind,
): string => `PAYREMIND#${sendOn}#${teamId}#${chargeId}#${kind}`;

/** Sort-key prefix for every dues reminder row. */
export const PAYMENT_REMINDER_SK_PREFIX = 'PAYREMIND#' as const;

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
