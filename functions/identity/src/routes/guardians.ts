/**
 * Guardian invite, accept, and remove routes.
 */

import { createGuardianInviteBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  acceptGuardianInvite,
  createGuardianInvite,
  removeGuardianLink,
} from '../../../lib/guardians.js';
import { withIdentityErrors } from './session.js';

/**
 * Handles `POST /identity/guardians`.
 *
 * @param event - The HTTP API event.
 * @returns The pending invite.
 */
export const handleCreateGuardianInvite = route(
  withIdentityErrors(),
  withBodyValidation(createGuardianInviteBodySchema),
  requireUser(),
  async ({ user, body }) => {
    const invite = await createGuardianInvite(user.userId, body.email);
    return json(201, invite);
  },
);

/**
 * Handles `POST /identity/guardians/:inviteId/accept`.
 *
 * @param event - The HTTP API event.
 * @param inviteId - The invite id from the path.
 * @returns The confirmed link.
 */
export const handleAcceptGuardianInvite = route(
  ['inviteId'],
  withIdentityErrors(),
  requireUser(),
  async ({ user, inviteId }) => {
    const link = await acceptGuardianInvite(inviteId, user.userId);
    return json(200, link);
  },
);

/**
 * Handles `DELETE /identity/guardians/:userId`.
 *
 * @param event - The HTTP API event.
 * @param otherUserId - The other person in the link, or the minor when an admin removes it.
 * @returns An empty 204.
 */
export const handleRemoveGuardianLink = route(
  ['otherUserId'],
  withIdentityErrors(),
  requireUser(),
  async ({ user, otherUserId }) => {
    await removeGuardianLink(user.userId, otherUserId);
    return json(204, {});
  },
);
