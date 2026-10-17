/**
 * Create, get, and update practice/game routes.
 */

import {
  createEventBodySchema,
  exceptionEventBodySchema,
  occurrenceTargetSchema,
  updateEventBodySchema,
} from "@gameplan/schemas";
import {
  requireMembership,
  requirePermission,
  requireUser,
} from "../../../lib/guards.js";
import { assertEventEndsAfterStart } from "@gameplan/rules";
import { badRequest, json } from "../../../lib/http.js";
import { route, withBodyValidation } from "../../../lib/pipeline.js";
import {
  cancelOccurrence,
  createEvent,
  deleteEvent,
  requireEvent,
  saveOccurrenceException,
  toEventResponse,
  updateEvent,
} from "../schedule-store.js";
import { withScheduleErrors } from "./errors.js";

/**
 * Handles `POST /schedule/teams/:teamId/events`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The created event.
 */
export const handleCreateEvent = route(
  ["teamId"],
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(createEventBodySchema),
  requireMembership(),
  requirePermission("manage_events"),
  async ({ teamId, user, body }) => {
    assertEventEndsAfterStart(body.startsAt, body.endsAt);
    const created = await createEvent({
      teamId,
      userId: user.userId,
      body,
    });
    return json(201, created);
  },
);

/**
 * Handles `GET /schedule/teams/:teamId/events/:eventId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param eventId - The event id from the path.
 * @returns The event definition.
 */
export const handleGetEvent = route(
  ["teamId", "eventId"],
  withScheduleErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId, eventId }) => {
    const item = await requireEvent(teamId, eventId);
    return json(200, toEventResponse(item));
  },
);

/**
 * Handles `PATCH /schedule/teams/:teamId/events/:eventId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param eventId - The event id from the path.
 * @returns The updated event.
 */
export const handleUpdateEvent = route(
  ["teamId", "eventId"],
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(updateEventBodySchema),
  requireMembership(),
  requirePermission("manage_events"),
  async ({ teamId, eventId, body }) => {
    if (Object.keys(body).length === 0) {
      return badRequest("invalid_body");
    }

    const existing = await requireEvent(teamId, eventId);
    const nextEndsAt =
      body.endsAt === null ? undefined : (body.endsAt ?? existing.endsAt);
    assertEventEndsAfterStart(body.startsAt ?? existing.startsAt, nextEndsAt);

    const updated = await updateEvent({ teamId, eventId, body });
    return json(200, updated);
  },
);

/**
 * Handles `DELETE /schedule/teams/:teamId/events/:eventId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param eventId - The event id from the path.
 * @returns An empty response when the series is gone.
 */
export const handleDeleteEvent = route(
  ["teamId", "eventId"],
  withScheduleErrors(),
  requireUser(),
  requireMembership(),
  requirePermission("manage_events"),
  async ({ teamId, eventId }) => {
    await deleteEvent(teamId, eventId);
    return { statusCode: 204 };
  },
);

/**
 * Handles `DELETE /schedule/teams/:teamId/events/:eventId/occurrences`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param eventId - The series or exception id from the path.
 * @returns An empty response when that date is cancelled.
 */
export const handleCancelOccurrence = route(
  ["teamId", "eventId"],
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(occurrenceTargetSchema),
  requireMembership(),
  requirePermission("manage_events"),
  async ({ teamId, eventId, body }) => {
    await cancelOccurrence({
      teamId,
      eventId,
      occurrenceStartsAt: body.occurrenceStartsAt,
    });
    return { statusCode: 204 };
  },
);

/**
 * Handles `POST /schedule/teams/:teamId/events/:eventId/occurrences`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param eventId - The series or exception id from the path.
 * @returns The split-off event for that date.
 */
export const handleSaveOccurrence = route(
  ["teamId", "eventId"],
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(exceptionEventBodySchema),
  requireMembership(),
  requirePermission("manage_events"),
  async ({ teamId, eventId, user, body }) => {
    const saved = await saveOccurrenceException({
      teamId,
      userId: user.userId,
      eventId,
      body,
    });
    return json(200, saved);
  },
);
