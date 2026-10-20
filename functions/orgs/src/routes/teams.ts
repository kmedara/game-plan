/**
 * The team's side of an organization: see it, accept or decline an
 * invitation, and leave. Joining hands the organization's admins `team_admin`
 * rights, so it takes the team's `manage_billing`.
 */

import { canWithRoles, rolesFromMembership } from '@gameplan/rules';
import { getItem, teamMemberSk, teamPk } from '../../../lib/dynamo/index.js';
import { requireMembership, requirePermission, requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { loadRolePermissionMatrix } from '../../../lib/permissions.js';
import { route } from '../../../lib/pipeline.js';
import { acceptOrgInvite, callerAdministersOrg, declineOrgInvite, removeOrgTeam, teamOrgStatus } from '../orgs-store.js';
import { withOrgsErrors } from './errors.js';

/**
 * Whether the caller, as a roster member, manages the team's billing.
 *
 * @param teamId - The team.
 * @param userId - The caller.
 * @returns `true` when their roles grant `manage_billing`.
 */
const managesTeamBilling = async (teamId: string, userId: string): Promise<boolean> => {
  const member = await getItem<{ role?: unknown; roles?: unknown }>(teamPk(teamId), teamMemberSk(userId));
  if (member === undefined) return false;
  return canWithRoles(rolesFromMembership(member), await loadRolePermissionMatrix(teamId), 'manage_billing');
};

/** `GET /orgs/teams/:teamId` — the team's organization and its invitations. */
export const handleTeamOrgStatus = route(
  'GET',
  '/orgs/teams/:teamId',
  withOrgsErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId }) => json(200, await teamOrgStatus(teamId)),
);

/** `POST /orgs/:orgId/teams/:teamId/accept` */
export const handleAcceptOrgInvite = route(
  'POST',
  '/orgs/:orgId/teams/:teamId/accept',
  withOrgsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('manage_billing'),
  async ({ orgId, teamId }) => {
    await acceptOrgInvite({ orgId, teamId });
    return json(200, await teamOrgStatus(teamId));
  },
);

/** `POST /orgs/:orgId/teams/:teamId/decline` */
export const handleDeclineOrgInvite = route(
  'POST',
  '/orgs/:orgId/teams/:teamId/decline',
  withOrgsErrors(),
  requireUser(),
  requireMembership(),
  requirePermission('manage_billing'),
  async ({ orgId, teamId }) => {
    await declineOrgInvite({ orgId, teamId });
    return json(200, await teamOrgStatus(teamId));
  },
);

/**
 * `DELETE /orgs/:orgId/teams/:teamId` — take a team out, or withdraw its
 * invitation. An organization admin or the team's own billing manager may,
 * so either side can end it.
 */
export const handleRemoveOrgTeam = route(
  'DELETE',
  '/orgs/:orgId/teams/:teamId',
  withOrgsErrors(),
  requireUser(),
  async ({ orgId, teamId, user }) => {
    const allowed =
      (await callerAdministersOrg(orgId, user.userId)) || (await managesTeamBilling(teamId, user.userId));
    if (!allowed) throw new Error('forbidden');
    await removeOrgTeam({ orgId, teamId });
    return { statusCode: 204, body: '' };
  },
);
