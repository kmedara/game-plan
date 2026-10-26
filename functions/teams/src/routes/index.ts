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
import {
  handleCreateWaiver,
  handleCreateWaiverFromTemplate,
  handleCreateWaiverPdfLink,
  handleGetSignature,
  handleGetWaiverPdf,
  handleGetWaiver,
  handleListMyWaivers,
  handleListTeamWaiverTemplates,
  handleListWaivers,
  handleRecordPaperWaiver,
  handleRemovePaperWaiver,
  handleSignWaiver,
  handleUpdateWaiver,
} from './waivers.js';

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
  handleCreateWaiver,
  handleCreateWaiverFromTemplate,
  handleCreateWaiverPdfLink,
  handleGetSignature,
  handleGetWaiver,
  handleGetWaiverPdf,
  handleListMyWaivers,
  handleListTeamWaiverTemplates,
  handleListWaivers,
  handleRecordPaperWaiver,
  handleRemovePaperWaiver,
  handleSignWaiver,
  handleUpdateWaiver,
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
  handleListMyWaivers,
  handleListWaivers,
  handleCreateWaiver,
  handleListTeamWaiverTemplates,
  handleCreateWaiverFromTemplate,
  handleGetWaiver,
  handleUpdateWaiver,
  handleSignWaiver,
  handleGetSignature,
  handleCreateWaiverPdfLink,
  handleGetWaiverPdf,
  handleRecordPaperWaiver,
  handleRemovePaperWaiver,
];
