/**
 * Volunteer sign-up routes. Staff with `manage_events` set the slots; any
 * member takes or gives up a place.
 */

import { canWithRoles } from '@gameplan/rules';
import { claimSignupBodySchema, putSignupsBodySchema, signupsQuerySchema } from '@gameplan/schemas';
import { requireMembership, requirePermission, requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { loadRolePermissionMatrix } from '../../../lib/permissions.js';
import { route, withBodyValidation, withQueryValidation } from '../../../lib/pipeline.js';
import { getSignups, putSignups, toggleSignup } from '../signups.js';
import { withScheduleErrors } from './errors.js';

/** `GET /schedule/teams/:teamId/signups?eventId=&occurrenceStartsAt=` */
export const handleGetSignups = route(
  'GET',
  '/schedule/teams/:teamId/signups',
  withScheduleErrors(),
  requireUser(),
  withQueryValidation(signupsQuerySchema),
  requireMembership(),
  async ({ teamId, query }) => json(200, await getSignups({ teamId, ...query })),
);

/** `PUT /schedule/teams/:teamId/signups` — replace the slot list. */
export const handlePutSignups = route(
  'PUT',
  '/schedule/teams/:teamId/signups',
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(putSignupsBodySchema),
  requireMembership(),
  requirePermission('manage_events'),
  async ({ teamId, body }) => json(200, await putSignups(teamId, body)),
);

/** `PUT /schedule/teams/:teamId/signups/claim` — take a place, or give it up. */
export const handleClaimSignup = route(
  'PUT',
  '/schedule/teams/:teamId/signups/claim',
  withScheduleErrors(),
  requireUser(),
  withBodyValidation(claimSignupBodySchema),
  requireMembership(),
  async ({ teamId, user, member, body }) => {
    const callerIsStaff =
      body.forUserId !== undefined &&
      body.forUserId !== user.userId &&
      canWithRoles(member.roles, await loadRolePermissionMatrix(teamId), 'manage_events');
    return json(200, await toggleSignup({ teamId, callerId: user.userId, callerIsStaff, body }));
  },
);
