/**
 * Organization route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import {
  handleAddOrgAdmin,
  handleAnnounce,
  handleCreateOrg,
  handleGetOrg,
  handleInviteTeam,
  handleListOrgs,
  handleRemoveOrgAdmin,
  handleUpdateOrg,
} from './orgs.js';
import {
  handleAcceptOrgInvite,
  handleDeclineOrgInvite,
  handleRemoveOrgTeam,
  handleTeamOrgStatus,
} from './teams.js';

export {
  handleAcceptOrgInvite,
  handleAddOrgAdmin,
  handleAnnounce,
  handleCreateOrg,
  handleDeclineOrgInvite,
  handleGetOrg,
  handleInviteTeam,
  handleListOrgs,
  handleRemoveOrgAdmin,
  handleRemoveOrgTeam,
  handleTeamOrgStatus,
  handleUpdateOrg,
};

/** Every organization HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handleListOrgs,
  handleCreateOrg,
  handleTeamOrgStatus,
  handleGetOrg,
  handleUpdateOrg,
  handleAddOrgAdmin,
  handleRemoveOrgAdmin,
  handleInviteTeam,
  handleRemoveOrgTeam,
  handleAcceptOrgInvite,
  handleDeclineOrgInvite,
  handleAnnounce,
];
