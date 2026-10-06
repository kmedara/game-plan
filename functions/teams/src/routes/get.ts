/**
 * `GET /teams/:teamId` — load one team the caller belongs to.
 */

import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import { toTeamSummary } from '../team-store.js';
import { withTeamsErrors } from './errors.js';
import { requireMembership, requireTeam } from './guard.js';

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
  requireTeam(),
  requireMembership(),
  async ({ team, member }) =>
    json(200, toTeamSummary(team, member.role, member.positions ?? [])),
);
