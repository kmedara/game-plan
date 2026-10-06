/**
 * Per-occurrence RSVP route.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { rsvpBodySchema } from '@gameplan/schemas';
import { json, withBodyValidation } from '../../../lib/http.js';
import { requireUser } from '../../../lib/auth/index.js';

import { requireMembership, upsertRsvp } from '../schedule-store.js';

import { withScheduleErrors } from './errors.js';

/**
 * Handles `PUT /schedule/teams/:teamId/rsvps`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The stored RSVP.
 */
export const handleUpsertRsvp = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withScheduleErrors(async () =>
    withBodyValidation(rsvpBodySchema, async (event, body) => {
      const user = await requireUser(event);
      await requireMembership(teamId, user.userId);
      const rsvp = await upsertRsvp({
        teamId,
        userId: user.userId,
        eventId: body.eventId,
        occurrenceStartsAt: body.occurrenceStartsAt,
        status: body.status,
      });
      return json(200, rsvp);
    })(event),
  );
