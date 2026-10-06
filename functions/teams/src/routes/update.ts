/**
 * `PATCH /teams/:teamId` — update the team name, time zone, location, and theme.
 */

import { updateTeamBodySchema } from "@gameplan/schemas";
import {
  requireMembership,
  requirePermission,
  requireUser,
} from "../../../lib/guards.js";
import { badRequest, json } from "../../../lib/http.js";
import { route, withBodyValidation } from "../../../lib/pipeline.js";
import { toTeamSummary, updateTeamSettings } from "../team-store.js";
import { withTeamsErrors } from "./errors.js";

/**
 * Handles `PATCH /teams/:teamId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The updated team summary.
 */
export const handleUpdateTeam = route(
  ["teamId"],
  withTeamsErrors(),
  withBodyValidation(updateTeamBodySchema),
  requireUser(),
  requirePermission("manage_permissions"),
  requireMembership(),
  async ({ teamId, member, body }) => {
    if (Object.keys(body).length === 0) return badRequest("invalid_body");

    const name = body.name?.trim();
    const timeZone = body.timeZone?.trim();
    if (body.name !== undefined && (name === undefined || name.length === 0)) {
      return badRequest("invalid_body");
    }
    if (
      body.timeZone !== undefined &&
      (timeZone === undefined || timeZone.length === 0)
    ) {
      return badRequest("invalid_body");
    }

    let location = body.location;
    if (typeof location === "string") {
      const trimmed = location.trim();
      location = trimmed.length === 0 ? null : trimmed;
    }

    const team = await updateTeamSettings({
      teamId,
      ...(name !== undefined ? { name } : {}),
      ...(timeZone !== undefined ? { timeZone } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(body.theme !== undefined ? { theme: body.theme } : {}),
    });
    return json(200, toTeamSummary(team, member.role));
  },
);
