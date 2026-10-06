/**
 * Schedule window expansion route.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { scheduleWindowQuerySchema } from '@gameplan/schemas';
import { json, withQueryValidation } from '../../../lib/http.js';
import { requireUser } from '../../../lib/auth/index.js';

import { listOccurrences, requireMembership } from '../schedule-store.js';

import { withScheduleErrors } from './errors.js';

/**
 * Handles `GET /schedule/teams/:teamId?from=&to=`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns Expanded occurrences and RSVPs in the window.
 */
export const handleListSchedule = (
  event: APIGatewayProxyEventV2,
  teamId: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withScheduleErrors(async () =>
    withQueryValidation(scheduleWindowQuerySchema, async (event, query) => {
      const user = await requireUser(event);
      await requireMembership(teamId, user.userId);
      const schedule = await listOccurrences(teamId, query.from, query.to);
      return json(200, schedule);
    })(event),
  );
