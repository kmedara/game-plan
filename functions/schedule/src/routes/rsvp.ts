/**
 * Per-occurrence RSVP route.
 */

import { rsvpBodySchema } from "@gameplan/schemas";
import { requireMembership, requireUser } from "../../../lib/guards.js";
import { json } from "../../../lib/http.js";
import { route, withBodyValidation } from "../../../lib/pipeline.js";
import { upsertRsvp } from "../schedule-store.js";
import { withScheduleErrors } from "./errors.js";

/**
 * Handles `PUT /schedule/teams/:teamId/rsvps`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The stored RSVP.
 */
export const handleUpsertRsvp = route(
  ["teamId"],
  withScheduleErrors(),
  withBodyValidation(rsvpBodySchema),
  requireUser(),
  requireMembership(),
  async ({ teamId, user, body }) => {
    const rsvp = await upsertRsvp({
      teamId,
      userId: user.userId,
      eventId: body.eventId,
      occurrenceStartsAt: body.occurrenceStartsAt,
      status: body.status,
    });
    return json(200, rsvp);
  },
);
