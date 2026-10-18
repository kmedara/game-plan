/**
 * `POST /teams` — create a team and its default chat.
 */

import { createTeamBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { assertCanCreateTeam } from '../../../lib/role-rules.js';
import { createTeam, toTeamSummary } from '../team-store.js';
import { withTeamsErrors } from './errors.js';

/**
 * Handles `POST /teams`.
 *
 * @param event - The HTTP API event.
 * @returns The created team or an error.
 */
export const handleCreateTeam = route(
  'POST',
  '/teams',
  withTeamsErrors(),
  requireUser(),
  withBodyValidation(createTeamBodySchema),
  async ({ user, body }) => {
    await assertCanCreateTeam(user.userId);
    const team = await createTeam({
      userId: user.userId,
      name: body.name,
      timeZone: body.timeZone,
      ...(body.sport !== undefined ? { sport: body.sport } : {}),
    });
    return json(201, toTeamSummary(team, 'team_admin'));
  },
);
