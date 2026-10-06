/**
 * Permission-matrix routes for the team admin screen.
 */

import { TEAM_ROLES } from "@gameplan/types";
import { updateRolePermissionsBodySchema } from "@gameplan/schemas";
import {
  requireMembership,
  requirePermission,
  requireUser,
} from "../../../lib/guards.js";
import { json } from "../../../lib/http.js";
import { loadRolePermissionMatrix } from "../../../lib/permissions.js";
import { route, withBodyValidation } from "../../../lib/pipeline.js";
import { updateRolePermissions } from "../team-store.js";
import { withTeamsErrors } from "./errors.js";

/**
 * Handles `GET /teams/:teamId/permissions`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The role-permission matrix.
 */
export const handleGetPermissions = route(
  ["teamId"],
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId }) => {
    const matrix = await loadRolePermissionMatrix(teamId);
    return json(200, {
      roles: TEAM_ROLES.map((role) => ({
        role,
        permissions: matrix[role],
      })),
    });
  },
);

/**
 * Handles `PUT /teams/:teamId/permissions`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The updated matrix.
 */
export const handleUpdatePermissions = route(
  ["teamId"],
  withTeamsErrors(),
  withBodyValidation(updateRolePermissionsBodySchema),
  requireUser(),
  requirePermission("manage_permissions"),
  async ({ teamId, body }) => {
    const matrix = await updateRolePermissions(teamId, body.roles);
    return json(200, {
      roles: TEAM_ROLES.map((role) => ({
        role,
        permissions: matrix[role],
      })),
    });
  },
);
