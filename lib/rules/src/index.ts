/**
 * Product rules shared by the API and the app.
 *
 * These functions only look at values the caller already has. Handlers that
 * must read the database call them after that read. The server still enforces
 * every rule; the app uses the same functions to avoid a request that will fail.
 */

import type {
  AccountKind,
  ChatParticipant,
  EventType,
  GameSide,
  PlanTier,
  TeamPermission,
  TeamPlan,
  TeamRole,
  UserSearchPolicy,
} from '@gameplan/types';
import { TEAM_ROLES } from '@gameplan/types';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/** Age at which an account is treated as an adult. */
const ADULT_AGE_YEARS = 18;

/** ISO calendar date pattern (`YYYY-MM-DD`). */
const BIRTHDAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** How many distinct positions one member may list. */
export const MAX_POSITIONS = 8;

/** v1 search policy: exact-email lookup returns adults only. */
export const V1_USER_SEARCH_POLICY: UserSearchPolicy = {
  adultsOnly: true,
};

/**
 * Derives adult vs minor from a birthday calendar date.
 *
 * Anyone who has not yet reached their 18th birthday is a minor.
 *
 * @param birthday - ISO date string (`YYYY-MM-DD`).
 * @param now - Clock used for the age check (defaults to the current time).
 * @returns `minor` when under 18, otherwise `adult`.
 */
export const accountKindFromBirthday = (
  birthday: string,
  now: Date = new Date(),
): AccountKind => {
  const match = BIRTHDAY_PATTERN.exec(birthday);
  if (match === null) throw new Error('invalid_birthday');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birthUtc = Date.UTC(year, month - 1, day);
  const birth = new Date(birthUtc);
  if (
    Number.isNaN(birthUtc) ||
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) {
    throw new Error('invalid_birthday');
  }

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (birthUtc > todayUtc) throw new Error('invalid_birthday');

  const eighteenthUtc = Date.UTC(year + ADULT_AGE_YEARS, month - 1, day);
  return todayUtc < eighteenthUtc ? 'minor' : 'adult';
};

/**
 * Resolves adult versus minor for a profile read.
 *
 * The birthday is the stored fact. When it is present, the kind is derived
 * from that date and the current day. A missing or unreadable birthday keeps
 * the stored kind.
 *
 * @param birthday - Calendar date of birth, when the profile has one.
 * @param stored - The kind saved on the profile row.
 * @param now - Clock used for the age check.
 * @returns The kind callers should enforce.
 */
export const accountKindForProfile = (
  birthday: string | undefined,
  stored: AccountKind,
  now: Date = new Date(),
): AccountKind => {
  if (birthday === undefined) return stored;
  try {
    return accountKindFromBirthday(birthday, now);
  } catch {
    return stored;
  }
};

/**
 * Returns whether two team-id lists share at least one team.
 *
 * @param left - Team ids for the first person.
 * @param right - Team ids for the second person.
 * @returns `true` when the intersection is non-empty.
 */
export const sharesTeam = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length === 0 || right.length === 0) return false;
  const set = new Set(left);
  return right.some((teamId) => set.has(teamId));
};

/**
 * An adult may create a team. A minor may not.
 *
 * @param accountKind - The caller's account kind.
 * @returns `true` when team creation is allowed.
 */
export const canCreateTeam = (accountKind: AccountKind): boolean => accountKind === 'adult';

/**
 * Only an adult may hold the `team_admin` role.
 *
 * @param accountKind - The member's account kind.
 * @returns `true` when the admin role is allowed.
 */
export const canBeTeamAdmin = (accountKind: AccountKind): boolean => accountKind === 'adult';

/**
 * Only an adult may be granted `manage_permissions`.
 *
 * @param accountKind - The member's account kind.
 * @returns `true` when that permission may be assigned through a role they hold.
 */
export const canHoldManagePermissions = (accountKind: AccountKind): boolean =>
  accountKind === 'adult';

/**
 * True when `callerRole` is the same rank or higher than `role`.
 *
 * {@link TEAM_ROLES} is ordered from highest rank to lowest.
 *
 * @param callerRole - The role of the member granting access.
 * @param role - The role being granted.
 * @returns Whether the caller may grant that role.
 */
export const callerCanGrant = (callerRole: TeamRole, role: TeamRole): boolean => {
  const callerRank = TEAM_ROLES.indexOf(callerRole);
  const roleRank = TEAM_ROLES.indexOf(role);
  return callerRank !== -1 && roleRank !== -1 && callerRank <= roleRank;
};

/**
 * Rejects a grant when the caller is below the role they are handing out.
 *
 * @param callerRole - The role of the member granting access.
 * @param role - The role being granted.
 */
export const assertCallerCanGrant = (callerRole: TeamRole, role: TeamRole): void => {
  if (!callerCanGrant(callerRole, role)) throw new Error('role_outranks_caller');
};

/**
 * Orders a role set from highest rank to lowest and drops duplicates.
 *
 * @param roles - Roles to normalize.
 * @returns Roles in {@link TEAM_ROLES} order.
 */
export const normalizeMemberRoles = (roles: readonly TeamRole[]): TeamRole[] => {
  const unique = [...new Set(roles)];
  unique.sort((left, right) => TEAM_ROLES.indexOf(left) - TEAM_ROLES.indexOf(right));
  return unique;
};

/**
 * Highest-ranked role in a set.
 *
 * {@link TEAM_ROLES} is ordered from highest rank to lowest.
 *
 * @param roles - Roles the member holds.
 * @returns The role used for rank checks.
 */
export const highestRole = (roles: readonly TeamRole[]): TeamRole => {
  const role = normalizeMemberRoles(roles)[0];
  if (role === undefined) throw new Error('roles_required');
  return role;
};

const isTeamRole = (value: unknown): value is TeamRole =>
  typeof value === 'string' && (TEAM_ROLES as readonly string[]).includes(value);

/**
 * Roles on a membership row.
 *
 * A row written before a member could hold more than one role has only `role`.
 *
 * @param item - A roster or user-side membership row.
 * @returns The held roles, highest rank first. Empty when the row has none.
 */
export const rolesFromMembership = (item: { role?: unknown; roles?: unknown }): TeamRole[] => {
  if (Array.isArray(item.roles)) {
    const roles = item.roles.filter(isTeamRole);
    if (roles.length > 0) return normalizeMemberRoles(roles);
  }
  if (isTeamRole(item.role)) return [item.role];
  return [];
};

/** Permissions keyed by role. A missing role grants nothing. */
export type RolePermissionMatrix = Readonly<Partial<Record<TeamRole, readonly TeamPermission[]>>>;

/**
 * Keys role-permission rows by role.
 *
 * @param rows - Rows as returned by `GET /teams/:teamId/permissions`.
 * @returns The same permissions keyed by role.
 */
export const permissionMatrix = (
  rows: readonly { role: TeamRole; permissions: readonly TeamPermission[] }[],
): RolePermissionMatrix => Object.fromEntries(rows.map((row) => [row.role, row.permissions]));

/**
 * Returns whether a role's permission list includes the given permission.
 *
 * @param permissions - Permissions granted to the role.
 * @param permission - The permission under test.
 * @returns `true` when the list contains the permission.
 */
export const roleHasPermission = (
  permissions: readonly TeamPermission[],
  permission: TeamPermission,
): boolean => permissions.includes(permission);

/**
 * Permission check for one role.
 *
 * @param role - The caller's role on the team.
 * @param matrix - Permissions keyed by role.
 * @param permission - The permission under test.
 * @returns `true` when the role grants the permission.
 */
export const canWithMatrix = (
  role: TeamRole,
  matrix: RolePermissionMatrix,
  permission: TeamPermission,
): boolean => roleHasPermission(matrix[role] ?? [], permission);

/**
 * Permission check for a member who may hold more than one role.
 *
 * @param roles - The caller's roles on the team.
 * @param matrix - Permissions keyed by role.
 * @param permission - The permission under test.
 * @returns `true` when any held role grants the permission.
 */
export const canWithRoles = (
  roles: readonly TeamRole[],
  matrix: RolePermissionMatrix,
  permission: TeamPermission,
): boolean => roles.some((role) => canWithMatrix(role, matrix, permission));

/**
 * Rejects a grant when the caller cannot grant every role in the set.
 *
 * @param callerRole - The highest role of the member granting access.
 * @param roles - The roles being granted or already held.
 */
export const assertCallerCanGrantRoles = (callerRole: TeamRole, roles: readonly TeamRole[]): void => {
  for (const role of roles) assertCallerCanGrant(callerRole, role);
};

/**
 * Returns whether an account may hold a role with the given permissions.
 *
 * @param accountKind - The member's account kind.
 * @param role - The proposed role.
 * @param permissions - Permissions currently attached to that role.
 * @returns `false` when a minor would become admin or hold `manage_permissions`.
 */
export const roleAllowedForAccount = (
  accountKind: AccountKind,
  role: TeamRole,
  permissions: readonly TeamPermission[] = [],
): boolean => {
  if (role === 'team_admin' && !canBeTeamAdmin(accountKind)) return false;
  if (permissions.includes('manage_permissions') && !canHoldManagePermissions(accountKind)) {
    return false;
  }
  return true;
};

/**
 * Rejects assigning a role that a minor account cannot hold.
 *
 * @param accountKind - The member's account kind.
 * @param role - The proposed role.
 * @param matrix - The team's role-permission matrix.
 */
export const assertRoleAllowedForAccount = (
  accountKind: AccountKind,
  role: TeamRole,
  matrix: Readonly<Partial<Record<TeamRole, readonly TeamPermission[]>>>,
): void => {
  const permissions = matrix[role] ?? [];
  if (role === 'team_admin' && !canBeTeamAdmin(accountKind)) {
    throw new Error('minor_cannot_be_team_admin');
  }
  if (permissions.includes('manage_permissions') && !canHoldManagePermissions(accountKind)) {
    throw new Error('minor_cannot_hold_manage_permissions');
  }
};

/**
 * Returns whether a proposed chat membership set satisfies the minor rule.
 *
 * A minor cannot be in a chat with someone who shares none of that minor's
 * teams. When every member is an adult, the set is always allowed.
 *
 * @param members - The full membership after the proposed change.
 * @returns `true` when every minor shares a team with every other member.
 */
export const isMinorChatMembershipAllowed = (members: readonly ChatParticipant[]): boolean => {
  const minors = members.filter((member) => member.accountKind === 'minor');
  if (minors.length === 0) return true;

  for (const minor of minors) {
    for (const other of members) {
      if (other.userId === minor.userId) continue;
      const linkedGuardian = (minor.guardianIds ?? []).includes(other.userId);
      if (!linkedGuardian && !sharesTeam(minor.teamIds, other.teamIds)) return false;
    }
  }
  return true;
};

/** The fields the guardian rules read from each chat member. */
type GuardianRuleMember = Pick<ChatParticipant, 'userId' | 'accountKind' | 'guardianIds'>;

/**
 * Whether a minor shares the chat with an adult who is not their guardian.
 *
 * @param minor - A minor in the chat.
 * @param members - Everyone in the chat.
 * @returns `true` when such an adult is present.
 */
const hasOutsideAdult = (minor: GuardianRuleMember, members: readonly GuardianRuleMember[]): boolean => {
  const guardians = new Set(minor.guardianIds ?? []);
  return members.some(
    (member) => member.accountKind === 'adult' && member.userId !== minor.userId && !guardians.has(member.userId),
  );
};

/**
 * Guardians who must join so no minor is with an outside adult alone.
 *
 * Every chat that adds members on its own (private chats, channels, carpools)
 * adds these. Two minors with no outside adult need none.
 *
 * @param members - The proposed membership.
 * @returns Guardian ids not already in the chat, without repeats.
 */
export const requiredGuardianIds = (members: readonly GuardianRuleMember[]): string[] => {
  const present = new Set(members.map((member) => member.userId));
  const needed = new Set<string>();
  for (const minor of members) {
    if (minor.accountKind !== 'minor' || !hasOutsideAdult(minor, members)) continue;
    for (const guardianId of minor.guardianIds ?? []) {
      if (!present.has(guardianId)) needed.add(guardianId);
    }
  }
  return [...needed];
};

/**
 * Returns whether every minor who is chatting with a non-guardian adult has a guardian in the set.
 *
 * Two minors on a shared team, with no outside adult, are allowed.
 *
 * @param members - The full membership after the proposed change.
 * @returns `true` when each such minor has a linked guardian in the chat.
 */
export const guardianPresentForAdultMinorChats = (
  members: readonly ChatParticipant[],
): boolean => {
  for (const minor of members) {
    if (minor.accountKind !== 'minor' || !hasOutsideAdult(minor, members)) continue;
    const guardians = new Set(minor.guardianIds ?? []);
    if (!members.some((member) => guardians.has(member.userId))) return false;
  }
  return true;
};

/**
 * Returns whether adding one person keeps the minor chat rule intact.
 *
 * @param existing - Current chat members.
 * @param adding - The person being added.
 * @returns `true` when the addition is allowed under the minor rule.
 */
export const canAddChatMember = (
  existing: readonly ChatParticipant[],
  adding: ChatParticipant,
): boolean => isMinorChatMembershipAllowed([...existing, adding]);

/**
 * Returns whether a profile may appear in search under the given policy.
 *
 * @param accountKind - The candidate's account kind.
 * @param policy - The search policy. Defaults to {@link V1_USER_SEARCH_POLICY}.
 * @returns `true` when the candidate should be returned to the caller.
 */
export const matchesUserSearchPolicy = (
  accountKind: AccountKind,
  policy: UserSearchPolicy = V1_USER_SEARCH_POLICY,
): boolean => !policy.adultsOnly || accountKind === 'adult';

/** Lowercases a name and collapses its spaces so words split cleanly. */
const normalizeName = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Returns whether a search query matches a person's name.
 *
 * Case is ignored. The query must start a word of the display name or of the
 * first and last name, so `ada`, `love`, and `ada lo` all find Ada Lovelace.
 * An empty query matches everyone.
 *
 * @param query - What the searcher typed.
 * @param person - The display name, plus the first and last name when known.
 * @returns `true` when the person should be offered.
 */
export const matchesPersonName = (
  query: string,
  person: { displayName?: string; firstName?: string; lastName?: string },
): boolean => {
  const needle = normalizeName(query);
  if (needle.length === 0) return true;
  const fullName = [person.firstName, person.lastName].filter((part) => part !== undefined).join(' ');
  return [person.displayName ?? '', fullName].some((name) => {
    const words = normalizeName(name).split(' ');
    return words.some((_, index) => words.slice(index).join(' ').startsWith(needle));
  });
};

/**
 * Counts positions after case-insensitive duplicates are collapsed.
 *
 * @param positions - Positions from the form or the request.
 * @returns The number of distinct names.
 */
export const distinctPositionCount = (positions: readonly string[]): number => {
  const seen = new Set<string>();
  for (const position of positions) seen.add(position.toLowerCase());
  return seen.size;
};

/**
 * Returns whether a position list stays within {@link MAX_POSITIONS}.
 *
 * @param positions - Positions from the form or the request.
 * @returns `false` when more than eight distinct names remain.
 */
export const positionsWithinLimit = (positions: readonly string[]): boolean =>
  distinctPositionCount(positions) <= MAX_POSITIONS;

/**
 * Rejects a position list with more than eight distinct names.
 *
 * @param positions - Positions from the request.
 */
export const assertPositionLimit = (positions: readonly string[]): void => {
  if (!positionsWithinLimit(positions)) throw new Error('too_many_positions');
};

/** Fields that decide what an event is called. */
export type EventTitleFields = {
  eventType: EventType;
  title?: string;
  opponentName?: string;
  side?: GameSide;
};

/**
 * The name an event goes by in reminders, pushes, and feeds.
 *
 * Practices and games have no title of their own: a practice is "Practice" and
 * a game is its side against the opponent. Meetings and other events use the
 * title they were given.
 *
 * @param event - The event type, title, and game fields.
 * @returns Plain English text, at most 200 characters.
 */
export const eventTitle = (event: EventTitleFields): string => {
  if (event.eventType === 'practice') return 'Practice';
  if (event.eventType === 'game') {
    const side = event.side === 'home' ? 'Home' : event.side === 'away' ? 'Away' : undefined;
    if (event.opponentName === undefined) return side === undefined ? 'Game' : `${side} game`;
    return `${side ?? 'Game'} vs ${event.opponentName}`.slice(0, 200);
  }
  return event.title ?? '';
};

/**
 * Returns whether an event end is missing or not before the start.
 *
 * @param startsAt - Series start ISO.
 * @param endsAt - Series end ISO, when set.
 * @returns `false` when the end instant is earlier than the start.
 */
export const eventWindowIsValid = (startsAt: string, endsAt: string | undefined): boolean => {
  if (endsAt === undefined || endsAt.length === 0) return true;
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return end >= start;
};

/**
 * Rejects an event whose end is before its start.
 *
 * @param startsAt - Series start ISO.
 * @param endsAt - Series end ISO, when set.
 */
export const assertEventEndsAfterStart = (startsAt: string, endsAt: string | undefined): void => {
  if (endsAt === undefined) return;
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime())) throw new Error('invalid_starts_at');
  if (Number.isNaN(end.getTime())) throw new Error('invalid_ends_at');
  if (end.getTime() < start.getTime()) throw new Error('invalid_ends_at');
};

/** The fields {@link payerIdsForDue} reads about the member who owes a due. */
export type DuePayerMember = {
  userId: string;
  accountKind: AccountKind;
  guardianIds?: readonly string[];
};

/**
 * Who may pay a member's due.
 *
 * An adult pays their own. A minor's is paid by any linked guardian; a minor
 * with no guardian has no in-app payer, and staff mark the due by hand.
 *
 * @param member - The member the due belongs to.
 * @returns User ids allowed to open a checkout, without repeats.
 */
export const payerIdsForDue = (member: DuePayerMember): string[] =>
  member.accountKind === 'adult' ? [member.userId] : [...new Set(member.guardianIds ?? [])];

/**
 * Returns whether a user may pay a member's due.
 *
 * @param payerId - The caller.
 * @param member - The member the due belongs to.
 * @returns `true` when the caller is in {@link payerIdsForDue}.
 */
export const canPayDue = (payerId: string, member: DuePayerMember): boolean =>
  payerIdsForDue(member).includes(payerId);

/**
 * Who may sign a waiver for a member. The same people who pay their dues: an
 * adult signs their own, a minor's is signed by any linked guardian, and a
 * minor with no guardian has no in-app signer, so staff record a paper form.
 *
 * @param member - The member the waiver is for.
 * @returns User ids allowed to sign, without repeats.
 */
export const waiverSignerIds = (member: DuePayerMember): string[] => payerIdsForDue(member);

/**
 * Returns whether a user may sign a waiver for a member.
 *
 * @param signerId - The caller.
 * @param member - The member the waiver is for.
 * @returns `true` when the caller is in {@link waiverSignerIds}.
 */
export const canSignWaiver = (signerId: string, member: DuePayerMember): boolean =>
  waiverSignerIds(member).includes(signerId);

/**
 * Whether a member must sign a waiver: they hold a role the waiver is for.
 *
 * @param roles - Roles the member holds on the team.
 * @param audience - Roles the waiver asks to sign.
 * @returns `true` when any held role is in the audience.
 */
export const mustSignWaiver = (roles: readonly TeamRole[], audience: readonly TeamRole[]): boolean =>
  roles.some((role) => audience.includes(role));

/**
 * Where a member stands on a waiver, from the latest version they signed.
 *
 * @param currentVersion - The waiver's current version.
 * @param signedVersion - The latest version the member signed, if any.
 * @returns `signed` for the current version, `outdated` for an earlier one, otherwise `missing`.
 */
export const waiverMemberStatus = (
  currentVersion: number,
  signedVersion: number | undefined,
): 'signed' | 'outdated' | 'missing' => {
  if (signedVersion === undefined) return 'missing';
  return signedVersion >= currentVersion ? 'signed' : 'outdated';
};

/** One gibibyte. */
const GIB = 1024 * 1024 * 1024;

/** How long a `past_due` plan keeps its features after the paid period ends. */
export const PLAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** What a team's plan unlocks. `undefined` means no limit. */
export type PlanLimits = {
  albumBytes: number;
  video: boolean;
  maxVideoBytes: number;
  maxVideoSeconds: number;
  practicePlans: number | undefined;
  waivers: boolean;
  aiMonthly: number;
  orgFeatures: boolean;
};

/** Limits by tier. Prices live in Stripe and the stores, not here. */
export const PLAN_LIMITS: Readonly<Record<PlanTier, PlanLimits>> = {
  free: {
    albumBytes: 2 * GIB,
    video: false,
    maxVideoBytes: 0,
    maxVideoSeconds: 0,
    practicePlans: 5,
    waivers: false,
    aiMonthly: 0,
    orgFeatures: false,
  },
  premium: {
    albumBytes: 50 * GIB,
    video: true,
    maxVideoBytes: GIB,
    maxVideoSeconds: 10 * 60,
    practicePlans: undefined,
    waivers: true,
    aiMonthly: 200,
    orgFeatures: false,
  },
  organization: {
    albumBytes: 50 * GIB,
    video: true,
    maxVideoBytes: GIB,
    maxVideoSeconds: 10 * 60,
    practicePlans: undefined,
    waivers: true,
    aiMonthly: 1000,
    orgFeatures: true,
  },
};

/** A team on no subscription. */
export const FREE_PLAN: TeamPlan = { tier: 'free', status: 'active' };

/**
 * The tier a plan grants right now.
 *
 * Active and trialing plans grant their tier. A `past_due` plan keeps it for
 * {@link PLAN_GRACE_MS} after the paid period ends, so a failed card does not
 * lock a team out mid-season. A canceled plan grants nothing.
 *
 * @param plan - The stored plan, or `undefined` for none.
 * @param now - The clock.
 * @returns The tier to enforce.
 */
export const effectivePlanTier = (plan: TeamPlan | undefined, now: Date = new Date()): PlanTier => {
  if (plan === undefined || plan.tier === 'free') return 'free';
  if (plan.status === 'active' || plan.status === 'trialing') return plan.tier;
  if (plan.status === 'past_due') {
    const end = plan.currentPeriodEnd === undefined ? Number.NaN : new Date(plan.currentPeriodEnd).getTime();
    return Number.isFinite(end) && now.getTime() <= end + PLAN_GRACE_MS ? plan.tier : 'free';
  }
  return 'free';
};

/** What a person or team may use, resolved from plans. */
export type Entitlements = PlanLimits & {
  tier: PlanTier;
  /** No ads for this person while looking at this team. */
  adFree: boolean;
  /** Original-quality album downloads. */
  fullQualityDownloads: boolean;
};

/**
 * Resolves what a team's plan, and optionally a person's add-on, unlock.
 *
 * @param input - The team's plan and whether the viewer holds the parent add-on.
 * @param now - The clock.
 * @returns Limits and flags to enforce.
 */
export const entitlementsFor = (
  input: { teamPlan?: TeamPlan; parentAddOn?: boolean },
  now: Date = new Date(),
): Entitlements => {
  const tier = effectivePlanTier(input.teamPlan, now);
  const addOn = input.parentAddOn === true;
  return {
    ...PLAN_LIMITS[tier],
    tier,
    adFree: tier !== 'free' || addOn,
    fullQualityDownloads: tier !== 'free' || addOn,
  };
};

/**
 * Whether a person sees ads anywhere.
 *
 * Minors never see ads. An adult sees none once any of their teams is on a
 * paid plan, or they hold the parent add-on.
 *
 * @param input - Account kind, every team plan the person belongs to, and the add-on.
 * @param now - The clock.
 * @returns `true` when ads may show.
 */
export const showsAds = (
  input: { accountKind: AccountKind; teamPlans: readonly (TeamPlan | undefined)[]; parentAddOn?: boolean },
  now: Date = new Date(),
): boolean =>
  input.accountKind === 'adult' &&
  input.parentAddOn !== true &&
  input.teamPlans.every((plan) => effectivePlanTier(plan, now) === 'free');

/**
 * Whether one more item fits under a count limit.
 *
 * @param current - Items already stored.
 * @param limit - The plan limit; `undefined` means none.
 * @returns `true` when another may be added.
 */
export const underLimit = (current: number, limit: number | undefined): boolean =>
  limit === undefined || current < limit;

/** One file someone wants to add to a team album. */
export type AlbumUpload = {
  contentType: string;
  bytes: number;
  /** A video's length, as the app read it from the file. */
  durationSeconds?: number;
};

/** Why an album upload is refused. The plan codes become `402`. */
export type AlbumUploadProblem = 'plan_required' | 'video_too_large' | 'video_too_long' | 'plan_limit_reached';

/**
 * Whether an album file is a video.
 *
 * @param contentType - The declared or stored type.
 * @returns `true` for a `video/` type.
 */
export const isAlbumVideo = (contentType: string): boolean => contentType.startsWith('video/');

/**
 * Why a team's plan refuses an album file, if it does.
 *
 * Video needs a plan with video, and each clip stays under the plan's size and
 * length. Every file must fit in the storage the album has left.
 *
 * @param limits - The team's plan limits.
 * @param usedBytes - Bytes the album already holds.
 * @param upload - The file's type, size, and length.
 * @returns The problem, or `undefined` when the file may be added.
 */
export const albumUploadProblem = (
  limits: Pick<PlanLimits, 'albumBytes' | 'video' | 'maxVideoBytes' | 'maxVideoSeconds'>,
  usedBytes: number,
  upload: AlbumUpload,
): AlbumUploadProblem | undefined => {
  if (isAlbumVideo(upload.contentType)) {
    if (!limits.video) return 'plan_required';
    if (upload.bytes > limits.maxVideoBytes) return 'video_too_large';
    if ((upload.durationSeconds ?? Number.POSITIVE_INFINITY) > limits.maxVideoSeconds) return 'video_too_long';
  }
  return usedBytes + upload.bytes > limits.albumBytes ? 'plan_limit_reached' : undefined;
};

/** The fields the emergency-info rules read about the person the record is for. */
export type MedicalSubject = {
  userId: string;
  accountKind: AccountKind;
  guardianIds?: readonly string[];
};

/**
 * Whether a caller may change someone's emergency and medical info.
 *
 * An adult keeps their own. A minor's is kept by their linked guardians.
 *
 * @param callerId - The caller.
 * @param subject - The person the record is for.
 * @returns `true` when the caller may write it.
 */
export const canEditMedicalInfo = (callerId: string, subject: MedicalSubject): boolean =>
  subject.accountKind === 'adult'
    ? callerId === subject.userId
    : (subject.guardianIds ?? []).includes(callerId);

/**
 * Whether a caller may read someone's emergency info outside a team: the
 * person themselves (a minor included) or a linked guardian. Team staff read
 * through their team with `view_medical_info`.
 *
 * @param callerId - The caller.
 * @param subject - The person the record is for.
 * @returns `true` when the caller may read it.
 */
export const canReadOwnMedicalInfo = (callerId: string, subject: MedicalSubject): boolean =>
  callerId === subject.userId || (subject.guardianIds ?? []).includes(callerId);

/**
 * Schemes the app may open. Anything else, such as `javascript:` or `data:`,
 * would run in the page or hand a crafted payload to another app.
 */
export const SAFE_LINK_SCHEMES = ['https:', 'mailto:', 'tel:', 'sms:', 'webcal:'] as const;

/**
 * Checks that a link is absolute and uses an allowed scheme.
 *
 * Parsing with `URL` rather than matching a prefix catches tricks such as
 * leading spaces, mixed case, and control characters (`java\tscript:`).
 *
 * @param url - The link to open.
 * @param schemes - Schemes allowed here. Defaults to {@link SAFE_LINK_SCHEMES}.
 * @returns `true` when the link may be opened.
 */
export const isSafeLink = (url: string, schemes: readonly string[] = SAFE_LINK_SCHEMES): boolean => {
  try {
    return schemes.includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

/**
 * Parses a contact phone into E.164.
 *
 * Numbers without a leading `+` are read as US numbers.
 *
 * @param value - The raw phone field.
 * @returns The E.164 number, or undefined when it is not a valid phone.
 */
export const toE164Phone = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = parsePhoneNumberFromString(trimmed, trimmed.startsWith('+') ? undefined : 'US');
  if (parsed === undefined || !parsed.isValid()) return undefined;
  return parsed.number;
};
