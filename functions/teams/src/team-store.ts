/**
 * DynamoDB item shapes and membership writes for the teams area.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { FREE_PLAN, highestRole, normalizeMemberRoles, rolesFromMembership } from "@gameplan/rules";
import {
  DEFAULT_ROLE_PERMISSIONS,
  TEAM_ROLES,
  type TeamPermission,
  type TeamPlan,
  type TeamRole,
  type TeamTheme,
} from "@gameplan/types";
import {
  JOIN_REQUEST_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  TEAM_INVITE_SK_PREFIX,
  TEAM_MEMBER_SK_PREFIX,
  USER_TEAM_SK_PREFIX,
  chatMetaSk,
  chatPk,
  deleteItem,
  getItem,
  incrementCounter,
  inviteMetaSk,
  invitePk,
  joinRequestSk,
  putItem,
  queryBySkPrefix,
  queryPage,
  rolePermissionsSk,
  sentInvitesSk,
  teamInviteSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  teamDirectoryPk,
  teamDirectorySk,
  transactWrite,
  userPk,
  userTeamSk,
} from "../../lib/dynamo/index.js";
import { chatMembershipItems } from "../../lib/chat-membership.js";
import { getProfile } from "../../lib/auth/profile.js";
import { refreshTeamFixtureChats } from "../../lib/fixture-chat.js";
import { enqueueFanout } from "../../lib/fanout-enqueue.js";
import { TABLE_NAME } from "../../lib/names.js";
import {
  loadRolePermissionMatrix,
  normalizeRolePermissions,
} from "../../lib/permissions.js";

/** Team metadata row under `TEAM#id` / `META`. */
export type TeamMetaItem = {
  PK: string;
  SK: string;
  teamId: string;
  name: string;
  timeZone: string;
  location?: string;
  /** Lowercase sport name. Omitted until the club sets one. */
  sport?: string;
  /** Team colors and logo. Omitted when the team uses the default brand. */
  theme?: TeamTheme;
  defaultChatId: string;
  createdBy: string;
  createdAt: string;
};

/** Roster membership under `TEAM#id` / `MEMBER#userId`. */
export type TeamMemberItem = {
  PK: string;
  SK: string;
  userId: string;
  /** Highest-ranked role. Kept so a row still has one role string. */
  role: TeamRole;
  /** Every role this member holds. Omitted on rows written before multi-role support. */
  roles?: TeamRole[];
  joinedAt: string;
  /** Positions this member plays. Omitted when they have not set any. */
  positions?: string[];
};

/** User-side team membership under `USER#id` / `TEAM#teamId`. */
export type UserTeamItem = {
  PK: string;
  SK: string;
  teamId: string;
  /** Highest-ranked role. Kept so a row still has one role string. */
  role: TeamRole;
  /** Every role this member holds. Omitted on rows written before multi-role support. */
  roles?: TeamRole[];
  joinedAt: string;
  /** Positions this member plays. Omitted when they have not set any. */
  positions?: string[];
};

/** How long an invite code stays usable. DynamoDB TTL deletes the rows later. */
const INVITE_TTL_SECONDS = 24 * 60 * 60;

/** Invite row shared by the team partition and the code lookup partition. */
export type InviteItem = {
  PK: string;
  SK: string;
  code: string;
  teamId: string;
  role: TeamRole;
  createdBy: string;
  createdAt: string;
  /** ISO instant after which the code is rejected. */
  expiresAt: string;
  /** Unix seconds for the table TTL attribute. */
  ttl: number;
};

/** Pending join request under `TEAM#id` / `JOIN#requestId`. */
export type JoinRequestItem = {
  PK: string;
  SK: string;
  requestId: string;
  userId: string;
  createdAt: string;
};

/** Searchable directory row under `TEAM_DIR` / `NAME#…`. */
export type TeamDirectoryItem = {
  PK: string;
  SK: string;
  teamId: string;
  name: string;
  /** The display name, trimmed and lowercased, for the case-sensitive `contains` filter. */
  nameSearch: string;
  timeZone: string;
  location?: string;
};

/**
 * Folds a display name for the directory name filter.
 *
 * DynamoDB `contains` is case-sensitive and has no lowercase function, so the
 * directory row stores this form beside the display name.
 *
 * @param name - The display name.
 * @returns The trimmed name in lower case.
 */
const directoryNameSearch = (name: string): string => name.trim().toLowerCase();

/**
 * Builds a short invite code suitable for a shared link.
 *
 * @returns A URL-safe invite code.
 */
export const newInviteCode = (): string => randomBytes(9).toString("base64url");

/**
 * Loads team metadata, or throws when the team does not exist.
 *
 * @param teamId - The team id.
 * @returns The team metadata row.
 */
export const requireTeam = async (teamId: string): Promise<TeamMetaItem> => {
  const team = await getItem<TeamMetaItem>(teamPk(teamId), teamMetaSk());
  if (team === undefined) throw new Error("team_not_found");
  return team;
};

/**
 * Maps the team metadata row to the member-facing summary.
 *
 * @param team - The team metadata row.
 * @param roleOrRoles - The caller's role, or every role they hold.
 * @param positions - Positions the caller plays.
 * @param plan - The team's plan; a new team is free.
 * @returns The wire summary, including location when the team has one.
 */
export const toTeamSummary = (
  team: Pick<
    TeamMetaItem,
    | "teamId"
    | "name"
    | "timeZone"
    | "location"
    | "sport"
    | "theme"
    | "defaultChatId"
    | "createdAt"
  >,
  roleOrRoles: TeamRole | readonly TeamRole[],
  positions: readonly string[] = [],
  plan: TeamPlan = FREE_PLAN,
) => {
  const roles = normalizeMemberRoles(Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles]);
  return {
    teamId: team.teamId,
    name: team.name,
    timeZone: team.timeZone,
    ...(team.location !== undefined ? { location: team.location } : {}),
    ...(team.sport !== undefined ? { sport: team.sport } : {}),
    ...(team.theme !== undefined ? { theme: team.theme } : {}),
    defaultChatId: team.defaultChatId,
    createdAt: team.createdAt,
    role: highestRole(roles),
    roles,
    ...(positions.length > 0 ? { positions: [...positions] } : {}),
    plan,
  };
};

/**
 * Role fields stored on both membership rows.
 *
 * `role` is the highest rank. `roles` is the full set.
 *
 * @param roles - Roles to store.
 * @returns The two fields written on a membership row.
 */
const membershipRoleFields = (
  roles: readonly TeamRole[],
): { role: TeamRole; roles: TeamRole[] } => {
  const normalized = normalizeMemberRoles(roles);
  return { role: highestRole(normalized), roles: normalized };
};

/**
 * Drops blank and repeated positions, keeping the first spelling of each.
 *
 * @param positions - Positions from the request, already schema-trimmed.
 * @returns The positions to store.
 */
const normalizePositions = (positions: readonly string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const position of positions) {
    const key = position.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(position);
  }
  return next;
};

/**
 * Attribute spread that omits `positions` when the member has none.
 *
 * @param positions - Stored positions, when present.
 * @returns A `positions` field, or an empty object.
 */
const positionsField = (
  positions: readonly string[] | undefined,
): { positions: string[] } | Record<string, never> =>
  positions !== undefined && positions.length > 0
    ? { positions: [...positions] }
    : {};

/**
 * Loads a roster membership, or returns `undefined` when absent.
 *
 * @param teamId - The team id.
 * @param userId - The member's user id.
 * @returns The membership row when present.
 */
export const getMembership = async (
  teamId: string,
  userId: string,
): Promise<TeamMemberItem | undefined> =>
  getItem<TeamMemberItem>(teamPk(teamId), teamMemberSk(userId));

/**
 * Requires the caller to already be on the roster.
 *
 * @param teamId - The team id.
 * @param userId - The caller's user id.
 * @returns The membership row.
 */
export const requireMembership = async (
  teamId: string,
  userId: string,
): Promise<TeamMemberItem> => {
  const member = await getMembership(teamId, userId);
  if (member === undefined) throw new Error("not_a_member");
  return member;
};

/**
 * Builds the four membership rows written when someone joins a team.
 *
 * @param team - The team metadata (needs `defaultChatId`).
 * @param userId - The joining user.
 * @param role - The assigned role.
 * @param joinedAt - ISO timestamp.
 * @returns Put items for a `TransactWriteItems` call.
 */
const membershipPuts = (
  team: Pick<TeamMetaItem, "teamId" | "defaultChatId">,
  userId: string,
  role: TeamRole,
  joinedAt: string,
) => {
  const table = TABLE_NAME;
  const roles = membershipRoleFields([role]);
  return [
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: teamPk(team.teamId),
          [TABLE_SK]: teamMemberSk(userId),
          userId,
          ...roles,
          joinedAt,
        } satisfies TeamMemberItem,
        ConditionExpression: "attribute_not_exists(#pk)",
        ExpressionAttributeNames: { "#pk": TABLE_PK },
      },
    },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: userPk(userId),
          [TABLE_SK]: userTeamSk(team.teamId),
          teamId: team.teamId,
          ...roles,
          joinedAt,
        } satisfies UserTeamItem,
      },
    },
    ...chatMembershipItems(
      { chatId: team.defaultChatId, kind: "default", teamId: team.teamId },
      userId,
      joinedAt,
    ).map((Item) => ({ Put: { TableName: table, Item } })),
  ];
};

/**
 * Creates a team, the default chat, admin membership, and the permission matrix.
 *
 * @param input - Creator id, display name, and time zone.
 * @returns The new team metadata.
 */
export const createTeam = async (input: {
  userId: string;
  name: string;
  timeZone: string;
  sport?: string;
}): Promise<TeamMetaItem> => {
  const teamId = randomUUID();
  const chatId = randomUUID();
  const createdAt = new Date().toISOString();
  const table = TABLE_NAME;

  const sport = normalizeSport(input.sport);
  const team: TeamMetaItem = {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMetaSk(),
    teamId,
    name: input.name.trim(),
    timeZone: input.timeZone.trim(),
    ...(sport !== undefined ? { sport } : {}),
    defaultChatId: chatId,
    createdBy: input.userId,
    createdAt,
  };

  const rolePuts = TEAM_ROLES.map((role) => ({
    Put: {
      TableName: table,
      Item: {
        [TABLE_PK]: teamPk(teamId),
        [TABLE_SK]: rolePermissionsSk(role),
        role,
        permissions: [...DEFAULT_ROLE_PERMISSIONS[role]],
      },
    },
  }));

  await transactWrite([
    { Put: { TableName: table, Item: team } },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: teamDirectoryPk(),
          [TABLE_SK]: teamDirectorySk(team.name, teamId),
          teamId,
          name: team.name,
          nameSearch: directoryNameSearch(team.name),
          timeZone: team.timeZone,
        } satisfies TeamDirectoryItem,
      },
    },
    ...rolePuts,
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: chatPk(chatId),
          [TABLE_SK]: chatMetaSk(),
          chatId,
          kind: "default",
          teamId,
          name: team.name,
          createdAt,
        },
      },
    },
    ...membershipPuts(team, input.userId, "team_admin", createdAt),
  ]);

  return team;
};

type ThemePatch = {
  [Key in keyof TeamTheme]?: TeamTheme[Key] | null;
};

/**
 * Writes one theme field. A type parameter keeps the key and value paired so a
 * string color is not assigned to the overlay enum.
 */
const writeThemeField = <Key extends keyof TeamTheme>(
  theme: TeamTheme,
  key: Key,
  value: TeamTheme[Key],
): void => {
  theme[key] = value;
};

/** Applies a theme patch. Omitted keys stay. `null` drops a key. `null` for the patch clears the theme. */
const mergeTheme = (
  existing: TeamTheme | undefined,
  patch: ThemePatch | null | undefined,
): TeamTheme | undefined => {
  if (patch === undefined) return existing;
  if (patch === null) return undefined;
  const next: TeamTheme = { ...existing };
  for (const key of Object.keys(patch) as (keyof TeamTheme)[]) {
    const value = patch[key];
    if (value === null || value === undefined) delete next[key];
    else writeThemeField(next, key, value);
  }
  return Object.keys(next).length > 0 ? (next as TeamTheme) : undefined;
};

/**
 * Updates the team name, time zone, and location.
 *
 * The directory row uses the name in its sort key, so a rename deletes the old
 * directory item and writes a new one in the same transaction. A rename also
 * writes the new name onto the default chat.
 *
 * @param input - The team id and the fields to change. A `null` location or theme clears it.
 * @returns The updated team metadata.
 */
/** Stores a sport in lowercase, or drops a blank value. */
const normalizeSport = (sport: string | undefined): string | undefined => {
  const value = sport?.trim().toLowerCase();
  return value === undefined || value.length === 0 ? undefined : value;
};

export const updateTeamSettings = async (input: {
  teamId: string;
  name?: string;
  timeZone?: string;
  location?: string | null;
  sport?: string | null;
  theme?: ThemePatch | null;
}): Promise<TeamMetaItem> => {
  const existing = await requireTeam(input.teamId);
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const timeZone =
    input.timeZone !== undefined ? input.timeZone.trim() : existing.timeZone;
  if (name.length === 0 || timeZone.length === 0)
    throw new Error("invalid_body");

  let location = existing.location;
  if (input.location === null) location = undefined;
  else if (input.location !== undefined) {
    const trimmed = input.location.trim();
    location = trimmed.length === 0 ? undefined : trimmed;
  }

  let theme = mergeTheme(existing.theme, input.theme);

  let sport = existing.sport;
  if (input.sport === null) sport = undefined;
  else if (input.sport !== undefined) sport = normalizeSport(input.sport);

  const next: TeamMetaItem = {
    [TABLE_PK]: existing.PK,
    [TABLE_SK]: existing.SK,
    teamId: existing.teamId,
    name,
    timeZone,
    defaultChatId: existing.defaultChatId,
    createdBy: existing.createdBy,
    createdAt: existing.createdAt,
    ...(location !== undefined ? { location } : {}),
    ...(sport !== undefined ? { sport } : {}),
    ...(theme !== undefined ? { theme } : {}),
  };

  const previousSk = teamDirectorySk(existing.name, existing.teamId);
  const nextSk = teamDirectorySk(name, existing.teamId);
  const directory: TeamDirectoryItem = {
    [TABLE_PK]: teamDirectoryPk(),
    [TABLE_SK]: nextSk,
    teamId: existing.teamId,
    name,
    nameSearch: directoryNameSearch(name),
    timeZone,
    ...(location !== undefined ? { location } : {}),
  };

  const defaultChatPuts = [];
  if (name !== existing.name) {
    const chat = await getItem<Record<string, unknown>>(
      chatPk(existing.defaultChatId),
      chatMetaSk(),
    );
    if (chat !== undefined) {
      defaultChatPuts.push({
        Put: {
          TableName: TABLE_NAME,
          Item: { ...chat, name },
        },
      });
    }
  }

  await transactWrite([
    { Put: { TableName: TABLE_NAME, Item: next } },
    { Put: { TableName: TABLE_NAME, Item: directory } },
    ...defaultChatPuts,
    ...(previousSk === nextSk
      ? []
      : [
          {
            Delete: {
              TableName: TABLE_NAME,
              Key: {
                [TABLE_PK]: teamDirectoryPk(),
                [TABLE_SK]: previousSk,
              },
            },
          },
        ]),
  ]);

  return next;
};

/** Default page size for directory autocomplete. */
const DEFAULT_DIRECTORY_PAGE = 10;

/**
 * Searches the team directory by name for join autocomplete.
 *
 * A non-empty query adds a DynamoDB filter, `contains` on `nameSearch` (the
 * display name, trimmed and lowercased). The directory partition is small in
 * v1, so a bounded page is enough without a Global Secondary Index (GSI).
 * DynamoDB applies `Limit` before the filter, so a page can return fewer than
 * `limit` matches. Callers page with the returned cursor.
 *
 * @param query - Typed search text; empty returns the next page of teams.
 * @param options - Page size and optional opaque cursor from a prior response.
 * @returns Matching directory rows and the next cursor when more rows remain.
 */
export const searchTeamDirectory = async (
  query: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<{ teams: TeamDirectoryItem[]; cursor?: string }> => {
  const limit = options.limit ?? DEFAULT_DIRECTORY_PAGE;
  const needle = directoryNameSearch(query);

  const page = await queryPage<TeamDirectoryItem>(
    {
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
      ...(needle.length > 0
        ? { FilterExpression: "contains(#nameSearch, :needle)" }
        : {}),
      ExpressionAttributeNames: {
        "#pk": TABLE_PK,
        "#sk": TABLE_SK,
        ...(needle.length > 0 ? { "#nameSearch": "nameSearch" } : {}),
      },
      ExpressionAttributeValues: {
        ":pk": teamDirectoryPk(),
        ":skPrefix": "NAME#",
        ...(needle.length > 0 ? { ":needle": needle } : {}),
      },
    },
    { limit, cursor: options.cursor },
  );

  return {
    teams: page.items,
    ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
  };
};

/**
 * Reads the team id from a user-side membership sort key (`TEAM#<teamId>`).
 *
 * @param sk - The sort key on the membership row.
 * @returns The team id, or `undefined` when the key is not a membership key.
 */
const teamIdFromUserTeamSk = (sk: unknown): string | undefined => {
  if (typeof sk !== "string" || !sk.startsWith(USER_TEAM_SK_PREFIX))
    return undefined;
  const teamId = sk.slice(USER_TEAM_SK_PREFIX.length);
  return teamId.length > 0 ? teamId : undefined;
};

/**
 * Lists teams the user belongs to.
 *
 * @param userId - The caller's user id.
 * @returns Team summaries with the caller's role.
 */
export const listUserTeams = async (
  userId: string,
): Promise<
  Array<{ team: TeamMetaItem; role: TeamRole; roles: TeamRole[]; positions: string[] }>
> => {
  const memberships = await queryBySkPrefix<UserTeamItem>(
    userPk(userId),
    USER_TEAM_SK_PREFIX,
  );
  const results: Array<{
    team: TeamMetaItem;
    role: TeamRole;
    roles: TeamRole[];
    positions: string[];
  }> = [];
  for (const membership of memberships) {
    const teamId =
      typeof membership.teamId === "string" && membership.teamId.length > 0
        ? membership.teamId
        : teamIdFromUserTeamSk(membership[TABLE_SK]);
    if (teamId === undefined) continue;
    const team = await getItem<TeamMetaItem>(teamPk(teamId), teamMetaSk());
    if (team === undefined) continue;
    const roles = rolesFromMembership(membership);
    if (roles.length === 0) continue;
    results.push({
      team,
      role: highestRole(roles),
      roles,
      positions: membership.positions ?? [],
    });
  }
  return results;
};

/**
 * Lists roster members for a team.
 *
 * @param teamId - The team id.
 * @returns Membership rows.
 */
export const listMembers = async (teamId: string): Promise<TeamMemberItem[]> =>
  queryBySkPrefix<TeamMemberItem>(teamPk(teamId), TEAM_MEMBER_SK_PREFIX);

/**
 * Replaces the roles a member holds. The route checks rank and account rules first.
 *
 * @param teamId - The team id.
 * @param userId - The member whose roles change.
 * @param roles - The replacement set. Must contain at least one role.
 */
export const assignMemberRole = async (
  teamId: string,
  userId: string,
  roles: readonly TeamRole[],
): Promise<TeamMemberItem> => {
  const member = await requireMembership(teamId, userId);
  const joinedAt = member.joinedAt;
  const positions = positionsField(member.positions);
  const roleFields = membershipRoleFields(roles);
  const updated: TeamMemberItem = {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMemberSk(userId),
    userId,
    ...roleFields,
    joinedAt,
    ...positions,
  };
  await transactWrite([
    { Put: { TableName: TABLE_NAME, Item: updated } },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          [TABLE_PK]: userPk(userId),
          [TABLE_SK]: userTeamSk(teamId),
          teamId,
          ...roleFields,
          joinedAt,
          ...positions,
        } satisfies UserTeamItem,
      },
    },
  ]);
  await refreshTeamFixtureChats(teamId);
  return updated;
};

/**
 * Replaces the positions the member plays on a team.
 *
 * Writes both the roster row and the user-side membership so a later role
 * change keeps the same list.
 *
 * @param teamId - The team id.
 * @param userId - The member updating their own positions.
 * @param positions - The replacement list. An empty list clears them.
 * @returns The member's roles and the positions that were stored.
 */
export const setMemberPositions = async (
  teamId: string,
  userId: string,
  positions: readonly string[],
): Promise<{ role: TeamRole; roles: TeamRole[]; positions: string[] }> => {
  const member = await requireMembership(teamId, userId);
  const next = normalizePositions(positions);
  const stored = positionsField(next);
  const roleFields = membershipRoleFields(rolesFromMembership(member));
  await transactWrite([
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          [TABLE_PK]: teamPk(teamId),
          [TABLE_SK]: teamMemberSk(userId),
          userId,
          ...roleFields,
          joinedAt: member.joinedAt,
          ...stored,
        } satisfies TeamMemberItem,
      },
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          [TABLE_PK]: userPk(userId),
          [TABLE_SK]: userTeamSk(teamId),
          teamId,
          ...roleFields,
          joinedAt: member.joinedAt,
          ...stored,
        } satisfies UserTeamItem,
      },
    },
  ]);
  return { ...roleFields, positions: next };
};

/**
 * Replaces the role-permission matrix for a team.
 *
 * @param teamId - The team id.
 * @param roles - Proposed permissions keyed by role.
 * @returns The normalized matrix that was stored.
 */
export const updateRolePermissions = async (
  teamId: string,
  roles: Array<{ role: TeamRole; permissions: readonly TeamPermission[] }>,
): Promise<Record<TeamRole, TeamPermission[]>> => {
  await requireTeam(teamId);
  const next = await loadRolePermissionMatrix(teamId);

  for (const entry of roles) {
    if (entry.role === "team_admin") {
      const proposed = [...new Set(entry.permissions)];
      const current = next.team_admin;
      const unchanged =
        proposed.length === current.length &&
        proposed.every((permission) => current.includes(permission));
      if (!unchanged) throw new Error("team_admin_permissions_locked");
      continue;
    }
    next[entry.role] = normalizeRolePermissions(entry.role, entry.permissions);
  }

  await transactWrite(
    TEAM_ROLES.map((role) => ({
      Put: {
        TableName: TABLE_NAME,
        Item: {
          [TABLE_PK]: teamPk(teamId),
          [TABLE_SK]: rolePermissionsSk(role),
          role,
          permissions: next[role],
        },
      },
    })),
  );

  await refreshTeamFixtureChats(teamId);
  return next;
};

/**
 * Creates a multi-use invite under the team and the code lookup partition.
 * A team keeps one invite per role; a second create returns the existing link.
 *
 * @param input - Team, creator, and role granted on accept.
 * @returns The invite rows' shared fields.
 */
export const createInvite = async (input: {
  teamId: string;
  createdBy: string;
  role: TeamRole;
}): Promise<InviteItem> => {
  await requireTeam(input.teamId);
  const existing = (await listInvites(input.teamId)).find(
    (invite) => invite.role === input.role,
  );
  if (existing !== undefined) return existing;
  const code = newInviteCode();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_SECONDS * 1000,
  ).toISOString();
  const shared = {
    code,
    teamId: input.teamId,
    role: input.role,
    createdBy: input.createdBy,
    createdAt,
    expiresAt,
    ttl: Math.floor(Date.parse(expiresAt) / 1000),
  };
  const teamRow: InviteItem = {
    [TABLE_PK]: teamPk(input.teamId),
    [TABLE_SK]: teamInviteSk(input.role),
    ...shared,
  };
  const lookupRow: InviteItem = {
    [TABLE_PK]: invitePk(code),
    [TABLE_SK]: inviteMetaSk(),
    ...shared,
  };
  try {
    await transactWrite([
      {
        Put: {
          TableName: TABLE_NAME,
          Item: teamRow,
          ConditionExpression: "attribute_not_exists(#pk)",
          ExpressionAttributeNames: { "#pk": TABLE_PK },
        },
      },
      { Put: { TableName: TABLE_NAME, Item: lookupRow } },
    ]);
  } catch (err) {
    const raced = (await listInvites(input.teamId)).find(
      (invite) => invite.role === input.role,
    );
    if (raced !== undefined) return raced;
    throw err;
  }
  return teamRow;
};

/**
 * Loads an invite from the shared code.
 *
 * @param code - The invite code from the link.
 * @returns The invite lookup row.
 */
export const getInviteByCode = async (code: string): Promise<InviteItem> => {
  const invite = await getItem<InviteItem>(invitePk(code), inviteMetaSk());
  if (invite === undefined) throw new Error("invite_not_found");
  return invite;
};

/** Invites GamePlan may email or text for one team in a UTC day. */
export const TEAM_DAILY_INVITE_SENDS = 100;

/** Invites GamePlan may email or text for one person in a UTC day, across teams. */
export const SENDER_DAILY_INVITE_SENDS = 50;

/**
 * Counts one emailed or texted invite against the team's and the sender's
 * daily limits. Texts cost money and both channels can be abused, so a full
 * day refuses further sends.
 *
 * @param teamId - The team the invite is for.
 * @param userId - The person sending it.
 * @param now - The current time.
 * @throws `invite_send_limit` when either limit is reached.
 */
export const countInviteSend = async (
  teamId: string,
  userId: string,
  now = new Date(),
): Promise<void> => {
  const day = now.toISOString().slice(0, 10);
  // Kept a day past the one it counts, then removed by TTL.
  const ttl = Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000) + 2 * 24 * 60 * 60;
  try {
    await incrementCounter(teamPk(teamId), sentInvitesSk(day), TEAM_DAILY_INVITE_SENDS, ttl);
    await incrementCounter(userPk(userId), sentInvitesSk(day), SENDER_DAILY_INVITE_SENDS, ttl);
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      throw new Error("invite_send_limit");
    }
    throw error;
  }
};

/**
 * Lists invites for a team.
 *
 * @param teamId - The team id.
 * @returns Invite rows on the team partition.
 */
export const listInvites = async (teamId: string): Promise<InviteItem[]> =>
  queryBySkPrefix<InviteItem>(teamPk(teamId), TEAM_INVITE_SK_PREFIX);

/**
 * Deletes every invite for a role, including older rows stored under the code.
 *
 * @param teamId - The team id.
 * @param role - The role whose code should stop working.
 */
export const deleteInvite = async (
  teamId: string,
  role: TeamRole,
): Promise<void> => {
  await requireTeam(teamId);
  const invites = (await listInvites(teamId)).filter(
    (invite) => invite.role === role,
  );
  if (invites.length === 0) throw new Error("invite_not_found");
  await transactWrite(
    invites.flatMap((invite) => [
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: { [TABLE_PK]: invite.PK, [TABLE_SK]: invite.SK },
        },
      },
      {
        Delete: {
          TableName: TABLE_NAME,
          Key: {
            [TABLE_PK]: invitePk(invite.code),
            [TABLE_SK]: inviteMetaSk(),
          },
        },
      },
    ]),
  );
};

/**
 * Redeems an invite: adds the user to the roster and the default chat.
 *
 * @param code - The invite code.
 * @param userId - The accepting user.
 * @returns The team and the new membership.
 */
export const acceptInvite = async (
  code: string,
  userId: string,
): Promise<{ team: TeamMetaItem; member: TeamMemberItem }> => {
  const invite = await getInviteByCode(code);
  const team = await requireTeam(invite.teamId);
  const existing = await getMembership(team.teamId, userId);
  if (existing !== undefined) throw new Error("already_a_member");

  const joinedAt = new Date().toISOString();
  await transactWrite(membershipPuts(team, userId, invite.role, joinedAt));

  return {
    team,
    member: {
      [TABLE_PK]: teamPk(team.teamId),
      [TABLE_SK]: teamMemberSk(userId),
      userId,
      role: invite.role,
      roles: [invite.role],
      joinedAt,
    },
  };
};

/**
 * Creates a pending join request for a non-member.
 *
 * @param teamId - The team id.
 * @param userId - The requester.
 * @returns The join request row.
 */
export const createJoinRequest = async (
  teamId: string,
  userId: string,
): Promise<JoinRequestItem> => {
  const team = await requireTeam(teamId);
  if ((await getMembership(teamId, userId)) !== undefined) {
    throw new Error("already_a_member");
  }

  const pending = await listJoinRequests(teamId);
  if (pending.some((row) => row.userId === userId)) {
    throw new Error("join_request_exists");
  }

  const requestId = randomUUID();
  const createdAt = new Date().toISOString();
  const item: JoinRequestItem = {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: joinRequestSk(requestId),
    requestId,
    userId,
    createdAt,
  };
  await putItem(item, {
    conditionExpression: "attribute_not_exists(#pk)",
    expressionAttributeNames: { "#pk": TABLE_PK },
  });

  const profile = await getProfile(userId);
  const requesterDisplayName = profile?.displayName?.trim() || "Someone";
  await enqueueFanout({
    type: "join_requested",
    teamId,
    requestId,
    teamName: team.name.slice(0, 200),
    requesterDisplayName: requesterDisplayName.slice(0, 100),
  });
  return item;
};

/**
 * Lists pending join requests for a team.
 *
 * @param teamId - The team id.
 * @returns Join request rows.
 */
export const listJoinRequests = async (
  teamId: string,
): Promise<JoinRequestItem[]> =>
  queryBySkPrefix<JoinRequestItem>(teamPk(teamId), JOIN_REQUEST_SK_PREFIX);

/**
 * Loads one pending join request.
 *
 * @param teamId - The team id.
 * @param requestId - The join request id.
 * @returns The row when it is still pending.
 */
export const getJoinRequest = async (
  teamId: string,
  requestId: string,
): Promise<JoinRequestItem | undefined> =>
  getItem<JoinRequestItem>(teamPk(teamId), joinRequestSk(requestId));

/**
 * Approves a join request and assigns a role.
 *
 * @param teamId - The team id.
 * @param requestId - The join request id.
 * @param role - The role to assign.
 * @returns The new membership and team metadata.
 */
export const approveJoinRequest = async (
  teamId: string,
  requestId: string,
  role: TeamRole,
): Promise<{ team: TeamMetaItem; member: TeamMemberItem }> => {
  const team = await requireTeam(teamId);
  const request = await getItem<JoinRequestItem>(
    teamPk(teamId),
    joinRequestSk(requestId),
  );
  if (request === undefined) throw new Error("join_request_not_found");

  if ((await getMembership(teamId, request.userId)) !== undefined) {
    await deleteItem(teamPk(teamId), joinRequestSk(requestId));
    throw new Error("already_a_member");
  }

  const joinedAt = new Date().toISOString();
  await transactWrite([
    ...membershipPuts(team, request.userId, role, joinedAt),
    {
      Delete: {
        TableName: TABLE_NAME,
        Key: {
          [TABLE_PK]: teamPk(teamId),
          [TABLE_SK]: joinRequestSk(requestId),
        },
      },
    },
  ]);

  return {
    team,
    member: {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(request.userId),
      userId: request.userId,
      role,
      roles: [role],
      joinedAt,
    },
  };
};

/**
 * Rejects (deletes) a pending join request.
 *
 * @param teamId - The team id.
 * @param requestId - The join request id.
 */
export const rejectJoinRequest = async (
  teamId: string,
  requestId: string,
): Promise<void> => {
  await requireTeam(teamId);
  const request = await getItem<JoinRequestItem>(
    teamPk(teamId),
    joinRequestSk(requestId),
  );
  if (request === undefined) throw new Error("join_request_not_found");
  await deleteItem(teamPk(teamId), joinRequestSk(requestId));
};
