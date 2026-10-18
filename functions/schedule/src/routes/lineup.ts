/**
 * Per-occurrence game lineup routes.
 */

import { lineupBodySchema, lineupQuerySchema } from "@gameplan/schemas";
import { requireMembership, requirePermission, requireUser } from "../../../lib/guards.js";
import { json } from "../../../lib/http.js";
import { route, withBodyValidation, withQueryValidation } from "../../../lib/pipeline.js";
import { getLineup, getPreviousLineup, putLineup } from "../schedule-store.js";
import { withScheduleErrors } from "./errors.js";

/**
 * Handles `GET /schedule/teams/:teamId/lineup`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The lineup for the occurrence, or the previous one in the series.
 */
export const handleGetLineup = route(
  "GET",
  "/schedule/teams/:teamId/lineup",
  withScheduleErrors(),
  requireUser(),
  withQueryValidation(lineupQuerySchema),
  requireMembership(),
  async ({ teamId, query }) => {
    const lineup =
      query.source === "previous"
        ? await getPreviousLineup({
            teamId,
            eventId: query.eventId,
            occurrenceStartsAt: query.occurrenceStartsAt,
          })
        : await getLineup({
            teamId,
            eventId: query.eventId,
            occurrenceStartsAt: query.occurrenceStartsAt,
          });
    return json(200, lineup);
  },
);

/**
 * Handles `PUT /schedule/teams/:teamId/lineup`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The stored lineup.
 */
export const handlePutLineup = route(
  "PUT",
  "/schedule/teams/:teamId/lineup",
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(lineupBodySchema),
  requireMembership(),
  requirePermission("manage_events"),
  async ({ teamId, body }) => {
    const lineup = await putLineup({
      teamId,
      eventId: body.eventId,
      occurrenceStartsAt: body.occurrenceStartsAt,
      slots: body.slots,
    });
    return json(200, lineup);
  },
);
