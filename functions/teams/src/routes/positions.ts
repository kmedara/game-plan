/**
 * `PUT /teams/:teamId/positions` — the caller sets the positions they play.
 */

import { updatePositionsBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { setMemberPositions, toTeamSummary } from '../team-store.js';
import { withTeamsErrors } from './errors.js';
import { requireTeam } from './guard.js';

/**
 * Handles `PUT /teams/:teamId/positions`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The team summary including the stored positions.
 */
export const handleSetPositions = route(
  ['teamId'],
  withTeamsErrors(),
  withBodyValidation(updatePositionsBodySchema),
  requireUser(),
  requireTeam(),
  async ({ teamId, user, team, body }) => {
    const membership = await setMemberPositions(teamId, user.userId, body.positions);
    return json(200, toTeamSummary(team, membership.role, membership.positions));
  },
);
