/**
 * `GET /teams/:teamId` — load one team the caller belongs to.
 */

import {
  requireMembership,
  requireUser,
} from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import {
  getMembership,
  requireTeam as loadTeam,
  toTeamSummary,
} from '../team-store.js';
import { withTeamsErrors } from './errors.js';

/**
 * Handles `GET /teams/:teamId`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team id from the path.
 * @returns The team record and the caller's role.
 */
export const handleGetTeam = route(
  ['teamId'],
  withTeamsErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId, member }) => {
    const team = await loadTeam(teamId);
    const membership = await getMembership(teamId, member.userId);
    return json(
      200,
      toTeamSummary(team, member.role, membership?.positions ?? []),
    );
  },
);
