/**
 * Teams, roster, invites, and permission-matrix wire contracts.
 */

import { teamPermissionSchema, teamRoleSchema } from "./enums.js";
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
    name: noSpecialCharsString,
    timeZone: timeZoneSchema,
  })
  .strict();

/** Body for updating a team's name, time zone, and location. */
export const updateTeamBodySchema = z
  .object({
    name: noSpecialCharsString.optional(),
    timeZone: z.string().min(1).max(64).optional(),
    location: z.union([z.string().max(200), z.null()]).optional(),
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

/** Team summary from `GET /teams` and `GET /teams/:teamId`. */
export const teamSummarySchema = z
  .object({
    teamId: z.string().min(1),
    name: z.string().min(1),
    timeZone: z.string().min(1),
    location: z.string().optional(),
    role: z.union([teamRoleSchema, z.string()]),
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

/** Inferred type for {@link teamSummarySchema}. */
export type TeamSummary = z.infer<typeof teamSummarySchema>;

/** Inferred type for {@link teamDirectoryHitSchema}. */
export type TeamDirectoryHit = z.infer<typeof teamDirectoryHitSchema>;

/** Inferred type for {@link searchTeamDirectoryQuerySchema}. */
export type SearchTeamDirectoryQuery = z.infer<
  typeof searchTeamDirectoryQuerySchema
>;
