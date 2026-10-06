/**
 * Create, get, and update practice/game routes.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import {
  createEventBodySchema,
  updateEventBodySchema,
} from '@gameplan/schemas';
import {
  badRequest,
  json,
  withBodyValidation,
  withErrors,
} from '../../../lib/http.js';
import { requireUser, requirePermission } from '../../../lib/auth/index.js';

import {
  createEvent,
  requireEvent,
  requireMembership,
  toEventResponse,
  updateEvent,
} from '../schedule-store.js';

import { mapScheduleError, withScheduleErrors } from './errors.js';

/**
 * Handles `POST /schedule/teams/:teamId/events`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The created event.
 */
export const handleCreateEvent = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withErrors(
    async () =>
      withBodyValidation(createEventBodySchema, async (event, body) => {
        const user = await requireUser(event);
        await requirePermission(user.userId, teamId, 'manage_events');
        const created = await createEvent({
          teamId,
          userId: user.userId,
          body,
        });
        return json(201, created);
      })(event),
    mapScheduleError,
  );

/**
 * Handles `GET /schedule/teams/:teamId/events/:eventId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param eventId - The event id from the path.
 * @returns The event definition.
 */
export const handleGetEvent = (
  event: APIGatewayProxyEventV2,
  teamId: string,
  eventId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withScheduleErrors(async () => {
    const user = await requireUser(event);
    await requireMembership(teamId, user.userId);
    const item = await requireEvent(teamId, eventId);
    return json(200, toEventResponse(item));
  });

/**
 * Handles `PATCH /schedule/teams/:teamId/events/:eventId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @param eventId - The event id from the path.
 * @returns The updated event.
 */
export const handleUpdateEvent = (
  event: APIGatewayProxyEventV2,
  teamId: string,
  eventId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withScheduleErrors(async () =>
    withBodyValidation(updateEventBodySchema, async (event, body) => {
      const user = await requireUser(event);
      await requirePermission(user.userId, teamId, 'manage_events');
      if (Object.keys(body).length === 0) {
        return badRequest('invalid_body');
      }

      const updated = await updateEvent({ teamId, eventId, body });
      return json(200, updated);
    })(event),
  );
