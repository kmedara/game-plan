/**
 * Propose, list, accept, decline, edit, and unlink shared fixtures.
 */

import {
  acceptFixtureBodySchema,
  proposeFixtureBodySchema,
  updateFixtureBodySchema,
} from '@gameplan/schemas';
import { requireMembership, requirePermission, requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  acceptFixture,
  declineFixture,
  listFixtures,
  proposeFixture,
  unlinkFixture,
  updateFixture,
} from '../fixture-store.js';
import { withScheduleErrors } from './errors.js';

/**
 * Handles `POST /schedule/teams/:teamId/events/:eventId/fixture`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The proposing team.
 * @param eventId - The game to share.
 * @returns The proposed fixture.
 */
export const handleProposeFixture = route(
  ['teamId', 'eventId'],
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(proposeFixtureBodySchema),
  requireMembership(),
  requirePermission('manage_events'),
  async ({ teamId, eventId, user, body }) => {
    const created = await proposeFixture({ teamId, eventId, userId: user.userId, body });
    return json(201, created);
  },
);

/**
 * Handles `GET /schedule/teams/:teamId/fixtures`.
 *
 * @param event - The HTTP API event.
 * @param teamId - The team whose invites and links to list.
 * @returns Pending invites and linked fixtures.
 */
export const handleListFixtures = route(
  ['teamId'],
  withScheduleErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId }) => json(200, await listFixtures(teamId)),
);

/**
 * Handles `POST /schedule/fixtures/:fixtureId/accept`.
 *
 * @param event - The HTTP API event.
 * @param fixtureId - The proposed fixture.
 * @returns The linked fixture.
 */
export const handleAcceptFixture = route(
  ['fixtureId'],
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(acceptFixtureBodySchema),
  async ({ fixtureId, user, body }) => json(200, await acceptFixture({ fixtureId, userId: user.userId, body })),
);

/**
 * Handles `POST /schedule/fixtures/:fixtureId/decline`.
 *
 * @param event - The HTTP API event.
 * @param fixtureId - The proposed fixture.
 * @returns An empty response when the proposal is gone.
 */
export const handleDeclineFixture = route(
  ['fixtureId'],
  withScheduleErrors(),
  requireUser(),
  async ({ fixtureId, user }) => {
    await declineFixture({ fixtureId, userId: user.userId });
    return { statusCode: 204 };
  },
);

/**
 * Handles `PATCH /schedule/fixtures/:fixtureId`.
 *
 * @param event - The HTTP API event.
 * @param fixtureId - The fixture to change.
 * @returns The updated fixture.
 */
export const handleUpdateFixture = route(
  ['fixtureId'],
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(updateFixtureBodySchema),
  async ({ fixtureId, user, body }) => json(200, await updateFixture({ fixtureId, userId: user.userId, body })),
);

/**
 * Handles `DELETE /schedule/fixtures/:fixtureId`.
 *
 * @param event - The HTTP API event.
 * @param fixtureId - The linked fixture.
 * @returns An empty response when both clubs are detached.
 */
export const handleUnlinkFixture = route(
  ['fixtureId'],
  withScheduleErrors(),
  requireUser(),
  async ({ fixtureId, user }) => {
    await unlinkFixture({ fixtureId, userId: user.userId });
    return { statusCode: 204 };
  },
);
