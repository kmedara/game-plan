/**
 * Schedule window expansion route.
 */

import { scheduleWindowQuerySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withQueryValidation } from '../../../lib/pipeline.js';
import { listOccurrences, requireMembership } from '../schedule-store.js';
import { withScheduleErrors } from './errors.js';

/**
 * Handles `GET /schedule/teams/:teamId?from=&to=`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns Expanded occurrences and RSVPs in the window.
 */
export const handleListSchedule = route(
  ['teamId'],
  withScheduleErrors(),
  withQueryValidation(scheduleWindowQuerySchema),
  requireUser(),
  async ({ teamId, user, query }) => {
    await requireMembership(teamId, user.userId);
    const schedule = await listOccurrences(teamId, query.from, query.to);
    return json(200, schedule);
  },
);
