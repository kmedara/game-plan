/**
 * Teams, roster, invites, and permission-matrix wire contracts.
 */

import { displayNameSchema } from "./display-name.js";
import { accountKindSchema, teamPermissionSchema, teamRoleSchema } from "./enums.js";
import { phoneNumberSchema } from "./phone.js";
import { timeZoneSchema } from "./time.js";
import { z } from "./zod.js";

/** Team or display name: letters, numbers, and internal spaces only. */
export const noSpecialCharsString = z
  .string()
  .regex(/^[a-zA-Z0-9]+(?:[ a-zA-Z0-9]*[a-zA-Z0-9])?$/, {
    message: "Name must be alphanumeric and contain only letters and numbers",
  });

/** Body for creating a team (also creates the default chat). */
export const createTeamBodySchema = z
  .object({
    name: displayNameSchema,
    timeZone: timeZoneSchema,
  })
  .strict();

/** `#RRGGBB` color a team chooses for its theme. */
export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Object key for a logo uploaded through the media presign API. */
const teamLogoKeySchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^uploads\/[^/\\]+\/[^/\\]+$/);

/**
 * Colors and logo a team shows in place of the default brand.
 *
 * At least one field is required. `null` on an update clears the theme.
 */
export const teamThemeSchema = z
  .object({
    primary: hexColorSchema.optional(),
    secondary: hexColorSchema.optional(),
    accent: hexColorSchema.optional(),
    logoKey: teamLogoKeySchema.optional(),
  })
  .strict()
  .refine(
    (theme) =>
      theme.primary !== undefined ||
      theme.secondary !== undefined ||
      theme.accent !== undefined ||
      theme.logoKey !== undefined,
    { message: "theme_empty" },
  );

/** Body for updating a team's name, time zone, location, and theme. */
export const updateTeamBodySchema = z
  .object({
    name: z.string().min(1).max(30).optional(),
    timeZone: z.string().min(1).max(64).optional(),
    location: z.union([z.string().max(200), z.null()]).optional(),
    theme: z.union([teamThemeSchema, z.null()]).optional(),
  })
  .strict();

/** One role's permission list on the admin matrix. */
export const rolePermissionsSchema = z.object({
  role: teamRoleSchema,
  permissions: z.array(teamPermissionSchema),
});

/** Body for replacing the team's role-permission matrix. */
export const updateRolePermissionsBodySchema = z
  .object({
    roles: z.array(rolePermissionsSchema).min(1),
  })
  .strict();

/** Body for creating a shareable invite code. */
export const createInviteBodySchema = z
  .object({
    role: teamRoleSchema.optional(),
  })
  .strict();

/** Body for approving a join request and assigning a role. */
export const approveJoinRequestBodySchema = z
  .object({
    role: teamRoleSchema,
  })
  .strict();

/** Body for changing a roster member's role. */
export const assignRoleBodySchema = z
  .object({
    role: teamRoleSchema,
  })
  .strict();

/**
 * A playing position on one team, such as `Fly-half` or `No. 8`.
 *
 * Letters, numbers, and internal spaces, hyphens, apostrophes, periods, or slashes.
 */
export const teamPositionSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9 .'/+-]*[A-Za-z0-9])?$/);

/** Body for replacing the caller's positions on one team. */
export const updatePositionsBodySchema = z
  .object({
    positions: z.array(teamPositionSchema),
  })
  .strict();

/** Team summary from `GET /teams` and `GET /teams/:teamId`. */
export const teamSummarySchema = z
  .object({
    teamId: z.string().min(1),
    name: z.string().min(1),
    timeZone: z.string().min(1),
    location: z.string().optional(),
    theme: teamThemeSchema.optional(),
    role: z.union([teamRoleSchema, z.string()]),
    /** Positions the caller plays on this team. Omitted when they have not set any. */
    positions: z.array(z.string().min(1).max(40)).optional(),
    defaultChatId: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
  })
  .strict();

/** Team hit from `GET /teams/directory` (join autocomplete). */
export const teamDirectoryHitSchema = z
  .object({
    teamId: z.string().min(1),
    name: z.string().min(1),
    timeZone: z.string().min(1),
    location: z.string().optional(),
  })
  .strict();

/** Query for `GET /teams/directory` (name search with a page cursor). */
export const searchTeamDirectoryQuerySchema = z
  .object({
    q: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

/** `GET /teams`. */
export const teamListSchema = z
  .object({
    teams: z.array(teamSummarySchema),
  })
  .strict();

/** One person on `GET /teams/:teamId/members`. */
export const teamMemberSchema = z
  .object({
    userId: z.string().min(1),
    role: teamRoleSchema,
    joinedAt: z.string().min(1),
    displayName: displayNameSchema.optional(),
    email: z.string().min(1).optional(),
    accountKind: accountKindSchema.optional(),
  })
  .strict();

/**
 * One teammate on `GET /teams/:teamId/members/:userId`.
 *
 * Adds photo, phone, and positions for the profile view.
 */
export const teamMemberProfileSchema = teamMemberSchema
  .extend({
    photoKey: z.string().min(1).max(512).optional(),
    phoneNumber: phoneNumberSchema.optional(),
    positions: z.array(z.string().min(1).max(40)).optional(),
  })
  .strict();

/** `GET /teams/:teamId/members`. */
export const teamMemberListSchema = z
  .object({
    members: z.array(teamMemberSchema),
  })
  .strict();

/** `GET /teams/directory`. */
export const teamDirectoryPageSchema = z
  .object({
    teams: z.array(teamDirectoryHitSchema),
    cursor: z.string().min(1).optional(),
  })
  .strict();

/** Invite from create and list. `createdBy` is present on list rows. */
export const teamInviteSchema = z
  .object({
    code: z.string().min(1),
    teamId: z.string().min(1),
    role: teamRoleSchema,
    createdBy: z.string().min(1).optional(),
    createdAt: z.string().min(1),
  })
  .strict();

/** `GET /teams/:teamId/invites`. */
export const teamInviteListSchema = z
  .object({
    invites: z.array(teamInviteSchema),
  })
  .strict();

/** `GET /teams/invite/:code`. */
export const invitePreviewSchema = z
  .object({
    code: z.string().min(1),
    teamId: z.string().min(1),
    teamName: z.string().min(1),
    role: teamRoleSchema,
    createdAt: z.string().min(1),
  })
  .strict();

/** `POST /teams/invite/:code/accept`. */
export const acceptedInviteSchema = z
  .object({
    teamId: z.string().min(1),
    name: z.string().min(1),
    timeZone: z.string().min(1),
    defaultChatId: z.string().min(1),
    role: teamRoleSchema,
    joinedAt: z.string().min(1),
  })
  .strict();

/** `POST /teams/:teamId/join-requests`. */
export const joinRequestCreatedSchema = z
  .object({
    requestId: z.string().min(1),
    teamId: z.string().min(1),
    userId: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();

/** One pending request from `GET /teams/:teamId/join-requests`. */
export const joinRequestSchema = z
  .object({
    requestId: z.string().min(1),
    userId: z.string().min(1),
    createdAt: z.string().min(1),
    displayName: displayNameSchema.optional(),
    email: z.string().min(1).optional(),
    accountKind: accountKindSchema.optional(),
  })
  .strict();

/** `GET /teams/:teamId/join-requests`. */
export const joinRequestListSchema = z
  .object({
    joinRequests: z.array(joinRequestSchema),
  })
  .strict();

/** `POST /teams/:teamId/join-requests/:requestId/approve`. */
export const approvedJoinRequestSchema = z
  .object({
    teamId: z.string().min(1),
    userId: z.string().min(1),
    role: teamRoleSchema,
    joinedAt: z.string().min(1),
    defaultChatId: z.string().min(1),
  })
  .strict();

/** `GET` and `PUT /teams/:teamId/permissions`. */
export const rolePermissionsResponseSchema = z
  .object({
    roles: z.array(rolePermissionsSchema),
  })
  .strict();

/** Inferred type for {@link teamThemeSchema}. */
export type TeamTheme = z.infer<typeof teamThemeSchema>;

/** Inferred type for {@link createTeamBodySchema}. */
export type CreateTeamBody = z.infer<typeof createTeamBodySchema>;

/** Inferred type for {@link updateTeamBodySchema}. */
export type UpdateTeamBody = z.infer<typeof updateTeamBodySchema>;

/** Inferred type for {@link rolePermissionsSchema}. */
export type RolePermissions = z.infer<typeof rolePermissionsSchema>;

/** Inferred type for {@link updateRolePermissionsBodySchema}. */
export type UpdateRolePermissionsBody = z.infer<
  typeof updateRolePermissionsBodySchema
>;

/** Inferred type for {@link createInviteBodySchema}. */
export type CreateInviteBody = z.infer<typeof createInviteBodySchema>;

/** Inferred type for {@link approveJoinRequestBodySchema}. */
export type ApproveJoinRequestBody = z.infer<
  typeof approveJoinRequestBodySchema
>;

/** Inferred type for {@link assignRoleBodySchema}. */
export type AssignRoleBody = z.infer<typeof assignRoleBodySchema>;

/** Inferred type for {@link updatePositionsBodySchema}. */
export type UpdatePositionsBody = z.infer<typeof updatePositionsBodySchema>;

/** Inferred type for {@link teamSummarySchema}. */
export type TeamSummary = z.infer<typeof teamSummarySchema>;

/** Inferred type for {@link teamDirectoryHitSchema}. */
export type TeamDirectoryHit = z.infer<typeof teamDirectoryHitSchema>;

/** Inferred type for {@link searchTeamDirectoryQuerySchema}. */
export type SearchTeamDirectoryQuery = z.infer<
  typeof searchTeamDirectoryQuerySchema
>;

/** Inferred type for {@link teamListSchema}. */
export type TeamList = z.infer<typeof teamListSchema>;

/** Inferred type for {@link teamMemberSchema}. */
export type TeamMember = z.infer<typeof teamMemberSchema>;

/** Inferred type for {@link teamMemberProfileSchema}. */
export type TeamMemberProfile = z.infer<typeof teamMemberProfileSchema>;

/** Inferred type for {@link teamMemberListSchema}. */
export type TeamMemberList = z.infer<typeof teamMemberListSchema>;

/** Inferred type for {@link teamDirectoryPageSchema}. */
export type TeamDirectoryPage = z.infer<typeof teamDirectoryPageSchema>;

/** Inferred type for {@link teamInviteSchema}. */
export type TeamInvite = z.infer<typeof teamInviteSchema>;

/** Inferred type for {@link teamInviteListSchema}. */
export type TeamInviteList = z.infer<typeof teamInviteListSchema>;

/** Inferred type for {@link invitePreviewSchema}. */
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

/** Inferred type for {@link acceptedInviteSchema}. */
export type AcceptedInvite = z.infer<typeof acceptedInviteSchema>;

/** Inferred type for {@link joinRequestCreatedSchema}. */
export type JoinRequestCreated = z.infer<typeof joinRequestCreatedSchema>;

/** Inferred type for {@link joinRequestSchema}. */
export type JoinRequest = z.infer<typeof joinRequestSchema>;

/** Inferred type for {@link joinRequestListSchema}. */
export type JoinRequestList = z.infer<typeof joinRequestListSchema>;

/** Inferred type for {@link approvedJoinRequestSchema}. */
export type ApprovedJoinRequest = z.infer<typeof approvedJoinRequestSchema>;

/** Inferred type for {@link rolePermissionsResponseSchema}. */
export type RolePermissionsResponse = z.infer<
  typeof rolePermissionsResponseSchema
>;
