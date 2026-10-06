/**
 * Create, get, and update practice/game routes.
 */

import { createEventBodySchema, updateEventBodySchema } from '@gameplan/schemas';
import { requirePermission, requireUser } from '../../../lib/auth/index.js';
import { badRequest, json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  createEvent,
  requireEvent,
  requireMembership,
  toEventResponse,
  updateEvent,
} from '../schedule-store.js';
import { withScheduleErrors } from './errors.js';

/**
 * Handles `POST /schedule/teams/:teamId/events`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The created event.
 */
export const handleCreateEvent = route(
  ['teamId'],
  withScheduleErrors(),
  withBodyValidation(createEventBodySchema),
  requireUser(),
  requirePermission('manage_events'),
  async ({ teamId, user, body }) => {
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
  ['teamId', 'eventId'],
  withScheduleErrors(),
  requireUser(),
  async ({ teamId, eventId, user }) => {
    await requireMembership(teamId, user.userId);
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
  ['teamId', 'eventId'],
  withScheduleErrors(),
  withBodyValidation(updateEventBodySchema),
  requireUser(),
  requirePermission('manage_events'),
  async ({ teamId, eventId, body }) => {
    if (Object.keys(body).length === 0) {
      return badRequest('invalid_body');
    }

    const updated = await updateEvent({ teamId, eventId, body });
    return json(200, updated);
  },
);
