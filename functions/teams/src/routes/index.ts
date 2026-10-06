/**
 * Teams route handlers.
 */

export { handleCreateTeam } from './create.js';
export { handleSearchDirectory } from './directory.js';
export { handleGetTeam } from './get.js';
export {
  handleAcceptInvite,
  handleCreateInvite,
  handleGetInvite,
  handleListInvites,
} from './invites.js';
export {
  handleApproveJoinRequest,
  handleCreateJoinRequest,
  handleListJoinRequests,
  handleRejectJoinRequest,
} from './join-requests.js';
export { handleListTeams } from './list.js';
export { handleSetPositions } from './positions.js';
export { handleAssignRole, handleListMembers } from './members.js';
export { handleGetPermissions, handleUpdatePermissions } from './permissions.js';
export { handleUpdateTeam } from './update.js';
