/**
 * Teams route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleCreateTeam } from './create.js';
import { handleSearchDirectory } from './directory.js';
import { handleGetTeam } from './get.js';
import {
  handleAcceptInvite,
  handleCreateInvite,
  handleDeleteInvite,
  handleSendInvite,
  handleGetInvite,
  handleListInvites,
} from './invites.js';
import {
  handleApproveJoinRequest,
  handleCreateJoinRequest,
  handleListJoinRequests,
  handleRejectJoinRequest,
} from './join-requests.js';
import { handleListTeams } from './list.js';
import { handleAssignRole, handleGetMember, handleGetMemberMedical, handleListMembers } from './members.js';
import { handleGetPermissions, handleUpdatePermissions } from './permissions.js';
import { handleSetPositions } from './positions.js';
import { handleUpdateTeam } from './update.js';

export {
  handleAcceptInvite,
  handleApproveJoinRequest,
  handleAssignRole,
  handleCreateInvite,
  handleCreateJoinRequest,
  handleCreateTeam,
  handleDeleteInvite,
  handleGetInvite,
  handleGetMember,
  handleGetMemberMedical,
  handleGetPermissions,
  handleGetTeam,
  handleListInvites,
  handleListJoinRequests,
  handleListMembers,
  handleListTeams,
  handleRejectJoinRequest,
  handleSearchDirectory,
  handleSendInvite,
  handleSetPositions,
  handleUpdatePermissions,
  handleUpdateTeam,
};

/** Every teams HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handleCreateTeam,
  handleListTeams,
  handleSearchDirectory,
  handleGetInvite,
  handleAcceptInvite,
  handleGetTeam,
  handleUpdateTeam,
  handleSetPositions,
  handleListMembers,
  handleGetMember,
  handleGetMemberMedical,
  handleAssignRole,
  handleGetPermissions,
  handleUpdatePermissions,
  handleCreateInvite,
  handleListInvites,
  handleSendInvite,
  handleDeleteInvite,
  handleCreateJoinRequest,
  handleListJoinRequests,
  handleApproveJoinRequest,
  handleRejectJoinRequest,
];
