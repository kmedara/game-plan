/**
 * Per-occurrence carpool routes. Any team member can offer or claim a seat.
 */

import { carpoolClaimBodySchema, carpoolOfferBodySchema, carpoolQuerySchema } from "@gameplan/schemas";
import { requireMembership, requireUser } from "../../../lib/guards.js";
import { json } from "../../../lib/http.js";
import { route, withBodyValidation, withQueryValidation } from "../../../lib/pipeline.js";
import { claimCarpool, getCarpool, putCarpoolOffer } from "../schedule-store.js";
import { withScheduleErrors } from "./errors.js";

/**
 * Handles `GET /schedule/teams/:teamId/carpool`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns Offers for the occurrence, or an empty list.
 */
export const handleGetCarpool = route(
  ["teamId"],
  withScheduleErrors(),
  withQueryValidation(carpoolQuerySchema),
  requireUser(),
  requireMembership(),
  async ({ teamId, query }) => {
    const carpool = await getCarpool({
      teamId,
      eventId: query.eventId,
      occurrenceStartsAt: query.occurrenceStartsAt,
    });
    return json(200, carpool);
  },
);

/**
 * Handles `PUT /schedule/teams/:teamId/carpool`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The offers left after the caller's change.
 */
export const handlePutCarpool = route(
  ["teamId"],
  withScheduleErrors(),
  withBodyValidation(carpoolOfferBodySchema),
  requireUser(),
  requireMembership(),
  async ({ teamId, user, body }) => {
    const carpool = await putCarpoolOffer({
      teamId,
      eventId: body.eventId,
      occurrenceStartsAt: body.occurrenceStartsAt,
      seats: body.seats,
      userId: user.userId,
    });
    return json(200, carpool);
  },
);

/**
 * Handles `PUT /schedule/teams/:teamId/carpool/claim`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The offers left after the caller claims or leaves.
 */
export const handleClaimCarpool = route(
  ["teamId"],
  withScheduleErrors(),
  withBodyValidation(carpoolClaimBodySchema),
  requireUser(),
  requireMembership(),
  async ({ teamId, user, body }) => {
    const carpool = await claimCarpool({
      teamId,
      eventId: body.eventId,
      occurrenceStartsAt: body.occurrenceStartsAt,
      driverUserId: body.driverUserId,
      userId: user.userId,
    });
    return json(200, carpool);
  },
);
