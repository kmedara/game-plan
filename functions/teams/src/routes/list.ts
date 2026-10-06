/**
 * `GET /teams` — list teams for the caller.
 */

import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import { listUserTeams, toTeamSummary } from '../team-store.js';
import { withTeamsErrors } from './errors.js';

/**
 * Handles `GET /teams`.
 *
 * @param event - The HTTP API event.
 * @returns The caller's team list.
 */
export const handleListTeams = route(
  withTeamsErrors(),
  requireUser(),
  async ({ user }) => {
    const teams = await listUserTeams(user.userId);
    return json(200, {
      teams: teams.map(({ team, role, positions }) => toTeamSummary(team, role, positions)),
    });
  },
);
