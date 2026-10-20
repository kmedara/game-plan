/**
 * Organization routes for its admins.
 */

import {
  addOrgAdminBodySchema,
  createOrgBodySchema,
  orgAnnouncementBodySchema,
  updateOrgBodySchema,
} from '@gameplan/schemas';
import { requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import {
  addOrgAdmin,
  announce,
  createOrg,
  inviteTeam,
  listMyOrgs,
  orgDetail,
  removeOrgAdmin,
  renameOrg,
} from '../orgs-store.js';
import { withOrgsErrors } from './errors.js';

/** `GET /orgs` — organizations the caller administers. */
export const handleListOrgs = route('GET', '/orgs', withOrgsErrors(), requireUser(), async ({ user }) =>
  json(200, { orgs: await listMyOrgs(user.userId) }),
);

/** `POST /orgs` — create one; the caller owns it. */
export const handleCreateOrg = route(
  'POST',
  '/orgs',
  withOrgsErrors(),
  requireUser(),
  withBodyValidation(createOrgBodySchema),
  async ({ user, body }) => json(201, await createOrg({ userId: user.userId, name: body.name })),
);

/** `GET /orgs/:orgId` — teams, admins, and plan. */
export const handleGetOrg = route('GET', '/orgs/:orgId', withOrgsErrors(), requireUser(), async ({ orgId, user }) =>
  json(200, await orgDetail(orgId, user.userId)),
);

/** `PATCH /orgs/:orgId` — rename. */
export const handleUpdateOrg = route(
  'PATCH',
  '/orgs/:orgId',
  withOrgsErrors(),
  requireUser(),
  withBodyValidation(updateOrgBodySchema),
  async ({ orgId, user, body }) => json(200, await renameOrg({ orgId, userId: user.userId, name: body.name })),
);

/** `POST /orgs/:orgId/admins` — the owner adds an adult by email. */
export const handleAddOrgAdmin = route(
  'POST',
  '/orgs/:orgId/admins',
  withOrgsErrors(),
  requireUser(),
  withBodyValidation(addOrgAdminBodySchema),
  async ({ orgId, user, body }) => {
    await addOrgAdmin({ orgId, userId: user.userId, email: body.email });
    return json(200, await orgDetail(orgId, user.userId));
  },
);

/** `DELETE /orgs/:orgId/admins/:adminId` — the owner removes an admin, or an admin leaves. */
export const handleRemoveOrgAdmin = route(
  'DELETE',
  '/orgs/:orgId/admins/:adminId',
  withOrgsErrors(),
  requireUser(),
  async ({ orgId, adminId, user }) => {
    await removeOrgAdmin({ orgId, userId: user.userId, adminId });
    return { statusCode: 204, body: '' };
  },
);

/** `POST /orgs/:orgId/teams/:teamId` — invite a team. */
export const handleInviteTeam = route(
  'POST',
  '/orgs/:orgId/teams/:teamId',
  withOrgsErrors(),
  requireUser(),
  async ({ orgId, teamId, user }) => {
    await inviteTeam({ orgId, userId: user.userId, teamId });
    return json(200, await orgDetail(orgId, user.userId));
  },
);

/** `POST /orgs/:orgId/announcements` — post to every team's main chat. Needs the organization plan. */
export const handleAnnounce = route(
  'POST',
  '/orgs/:orgId/announcements',
  withOrgsErrors(),
  requireUser(),
  withBodyValidation(orgAnnouncementBodySchema),
  async ({ orgId, user, body }) =>
    json(
      200,
      await announce({
        orgId,
        userId: user.userId,
        body: body.body,
        ...(body.teamIds !== undefined ? { teamIds: body.teamIds } : {}),
      }),
    ),
);
