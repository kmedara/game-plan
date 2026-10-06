/**
 * DynamoDB item shapes and membership writes for the teams area.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { AccountKind, TeamPermission, TeamRole, TeamTheme } from "@gameplan/types";
import { DEFAULT_ROLE_PERMISSIONS, TEAM_ROLES } from "@gameplan/types";
import { getProfile } from "../../lib/auth/profile.js";
import {
  JOIN_REQUEST_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  TEAM_INVITE_SK_PREFIX,
  TEAM_MEMBER_SK_PREFIX,
  USER_TEAM_SK_PREFIX,
  chatMemberSk,
  chatMetaSk,
  chatPk,
  deleteItem,
  getItem,
  inviteMetaSk,
  invitePk,
  joinRequestSk,
  putItem,
  queryBySkPrefix,
  queryPage,
  rolePermissionsSk,
  teamInviteSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  teamDirectoryPk,
  teamDirectorySk,
  transactWrite,
  userChatSk,
  userPk,
  userTeamSk,
} from "../../lib/dynamo/index.js";
import {
  canBeTeamAdmin,
  canCreateTeam,
  canHoldManagePermissions,
} from "../../lib/minor-chat.js";
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
  role: TeamRole;
  joinedAt: string;
  /** Positions this member plays. Omitted when they have not set any. */
  positions?: string[];
};

/** User-side team membership under `USER#id` / `TEAM#teamId`. */
export type UserTeamItem = {
  PK: string;
  SK: string;
  teamId: string;
  role: TeamRole;
  joinedAt: string;
  /** Positions this member plays. Omitted when they have not set any. */
  positions?: string[];
};

/** Invite row shared by the team partition and the code lookup partition. */
export type InviteItem = {
  PK: string;
  SK: string;
  code: string;
  teamId: string;
  role: TeamRole;
  createdBy: string;
  createdAt: string;
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
 * @param role - The caller's role on the team.
 * @returns The wire summary, including location when the team has one.
 */
export const toTeamSummary = (
  team: Pick<
    TeamMetaItem,
    'teamId' | 'name' | 'timeZone' | 'location' | 'theme' | 'defaultChatId' | 'createdAt'
  >,
  role: TeamRole,
  positions: readonly string[] = [],
) => ({
  teamId: team.teamId,
  name: team.name,
  timeZone: team.timeZone,
  ...(team.location !== undefined ? { location: team.location } : {}),
  ...(team.theme !== undefined ? { theme: team.theme } : {}),
  defaultChatId: team.defaultChatId,
  createdAt: team.createdAt,
  role,
  ...(positions.length > 0 ? { positions: [...positions] } : {}),
});

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
  if (next.length > 8) throw new Error('too_many_positions');
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
  if (role === "team_admin" && !canBeTeamAdmin(accountKind)) {
    throw new Error("minor_cannot_be_team_admin");
  }
  const permissions = matrix[role] ?? [];
  if (
    permissions.includes("manage_permissions") &&
    !canHoldManagePermissions(accountKind)
  ) {
    throw new Error("minor_cannot_hold_manage_permissions");
  }
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
  return [
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: teamPk(team.teamId),
          [TABLE_SK]: teamMemberSk(userId),
          userId,
          role,
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
          role,
          joinedAt,
        } satisfies UserTeamItem,
      },
    },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: chatPk(team.defaultChatId),
          [TABLE_SK]: chatMemberSk(userId),
          userId,
          joinedAt,
        },
      },
    },
    {
      Put: {
        TableName: table,
        Item: {
          [TABLE_PK]: userPk(userId),
          [TABLE_SK]: userChatSk(team.defaultChatId),
          chatId: team.defaultChatId,
          teamId: team.teamId,
          kind: "default",
        },
      },
    },
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
}): Promise<TeamMetaItem> => {
  const profile = await getProfile(input.userId);
  if (profile === undefined) throw new Error("profile_not_found");
  if (!canCreateTeam(profile.accountKind))
    throw new Error("minor_cannot_create_team");

  const teamId = randomUUID();
  const chatId = randomUUID();
  const createdAt = new Date().toISOString();
  const table = TABLE_NAME;

  const team: TeamMetaItem = {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMetaSk(),
    teamId,
    name: input.name.trim(),
    timeZone: input.timeZone.trim(),
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
export const updateTeamSettings = async (input: {
  teamId: string;
  name?: string;
  timeZone?: string;
  location?: string | null;
  theme?: TeamTheme | null;
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

  let theme = existing.theme;
  if (input.theme === null) theme = undefined;
  else if (input.theme !== undefined) theme = input.theme;

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
 * Lists teams the user belongs to.
 *
 * @param userId - The caller's user id.
 * @returns Team summaries with the caller's role.
 */
export const listUserTeams = async (
  userId: string,
): Promise<Array<{ team: TeamMetaItem; role: TeamRole; positions: string[] }>> => {
  const memberships = await queryBySkPrefix<UserTeamItem>(
    userPk(userId),
    USER_TEAM_SK_PREFIX,
  );
  const results: Array<{ team: TeamMetaItem; role: TeamRole; positions: string[] }> = [];
  for (const membership of memberships) {
    if (typeof membership.teamId !== "string") continue;
    const team = await getItem<TeamMetaItem>(
      teamPk(membership.teamId),
      teamMetaSk(),
    );
    if (team === undefined) continue;
    results.push({
      team,
      role: membership.role,
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
 * Assigns a roster role after permission and minor-rule checks in the route.
 *
 * @param teamId - The team id.
 * @param userId - The member whose role changes.
 * @param role - The new role.
 */
export const assignMemberRole = async (
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<TeamMemberItem> => {
  const member = await requireMembership(teamId, userId);
  const profile = await getProfile(userId);
  if (profile === undefined) throw new Error("profile_not_found");
  const matrix = await loadRolePermissionMatrix(teamId);
  assertRoleAllowedForAccount(profile.accountKind, role, matrix);

  const joinedAt = member.joinedAt;
  const positions = positionsField(member.positions);
  const updated: TeamMemberItem = {
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMemberSk(userId),
    userId,
    role,
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
          role,
          joinedAt,
          ...positions,
        } satisfies UserTeamItem,
      },
    },
  ]);
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
 * @returns The member's role and the positions that were stored.
 */
export const setMemberPositions = async (
  teamId: string,
  userId: string,
  positions: readonly string[],
): Promise<{ role: TeamRole; positions: string[] }> => {
  const member = await requireMembership(teamId, userId);
  const next = normalizePositions(positions);
  const stored = positionsField(next);
  await transactWrite([
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          [TABLE_PK]: teamPk(teamId),
          [TABLE_SK]: teamMemberSk(userId),
          userId,
          role: member.role,
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
          role: member.role,
          joinedAt: member.joinedAt,
          ...stored,
        } satisfies UserTeamItem,
      },
    },
  ]);
  return { role: member.role, positions: next };
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
  const members = await listMembers(teamId);
  const next = await loadRolePermissionMatrix(teamId);

  for (const entry of roles) {
    next[entry.role] = normalizeRolePermissions(entry.role, entry.permissions);
  }

  for (const role of TEAM_ROLES) {
    if (!next[role].includes("manage_permissions")) continue;
    for (const member of members) {
      if (member.role !== role) continue;
      const profile = await getProfile(member.userId);
      if (profile === undefined) continue;
      if (!canHoldManagePermissions(profile.accountKind)) {
        throw new Error("minor_cannot_hold_manage_permissions");
      }
    }
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

  return next;
};

/**
 * Creates a multi-use invite under the team and the code lookup partition.
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
  const code = newInviteCode();
  const createdAt = new Date().toISOString();
  const shared = {
    code,
    teamId: input.teamId,
    role: input.role,
    createdBy: input.createdBy,
    createdAt,
  };
  const teamRow: InviteItem = {
    [TABLE_PK]: teamPk(input.teamId),
    [TABLE_SK]: teamInviteSk(code),
    ...shared,
  };
  const lookupRow: InviteItem = {
    [TABLE_PK]: invitePk(code),
    [TABLE_SK]: inviteMetaSk(),
    ...shared,
  };
  await transactWrite([
    { Put: { TableName: TABLE_NAME, Item: teamRow } },
    { Put: { TableName: TABLE_NAME, Item: lookupRow } },
  ]);
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

/**
 * Lists invites for a team.
 *
 * @param teamId - The team id.
 * @returns Invite rows on the team partition.
 */
export const listInvites = async (teamId: string): Promise<InviteItem[]> =>
  queryBySkPrefix<InviteItem>(teamPk(teamId), TEAM_INVITE_SK_PREFIX);

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

  const profile = await getProfile(userId);
  if (profile === undefined) throw new Error("profile_not_found");
  const matrix = await loadRolePermissionMatrix(team.teamId);
  assertRoleAllowedForAccount(profile.accountKind, invite.role, matrix);

  const joinedAt = new Date().toISOString();
  await transactWrite(membershipPuts(team, userId, invite.role, joinedAt));

  return {
    team,
    member: {
      [TABLE_PK]: teamPk(team.teamId),
      [TABLE_SK]: teamMemberSk(userId),
      userId,
      role: invite.role,
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
  await requireTeam(teamId);
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

  const profile = await getProfile(request.userId);
  if (profile === undefined) throw new Error("profile_not_found");
  const matrix = await loadRolePermissionMatrix(teamId);
  assertRoleAllowedForAccount(profile.accountKind, role, matrix);

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
