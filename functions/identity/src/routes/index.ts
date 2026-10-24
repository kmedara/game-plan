/**
 * Identity route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleCompleteProfile } from './complete-profile.js';
import { handleConfirmRegistration, handleResendConfirmation } from './confirm.js';
import {
  handleAcceptGuardianInvite,
  handleCreateGuardianInvite,
  handleRemoveGuardianLink,
} from './guardians.js';
import { handleDeleteAccount } from './delete-account.js';
import { handleLogin } from './login.js';
import { handleLogout } from './logout.js';
import { handleMe } from './me.js';
import { handleListMedical, handlePutMedical } from './medical.js';
import {
  handleOAuthCallback,
  handleOAuthLogin,
  handleOAuthLogout,
  handleOAuthProviders,
} from './oauth.js';
import { handleOAuthExchange } from './oauth-exchange.js';
import { handleGetPreferences, handleUpdatePreferences } from './preferences.js';
import { handleRefresh } from './refresh.js';
import { handleRegister } from './register.js';
import { handleSocketTicket } from './socket-ticket.js';
import { handleSupportRequest } from './support.js';
import { handleUpdateProfile } from './update-profile.js';

export {
  handleAcceptGuardianInvite,
  handleCompleteProfile,
  handleConfirmRegistration,
  handleCreateGuardianInvite,
  handleDeleteAccount,
  handleGetPreferences,
  handleLogin,
  handleListMedical,
  handleLogout,
  handleMe,
  handleOAuthCallback,
  handleOAuthExchange,
  handleOAuthLogin,
  handleOAuthLogout,
  handleOAuthProviders,
  handlePutMedical,
  handleRefresh,
  handleRegister,
  handleRemoveGuardianLink,
  handleResendConfirmation,
  handleSocketTicket,
  handleSupportRequest,
  handleUpdatePreferences,
  handleUpdateProfile,
};

/** Every identity HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handleRegister,
  handleResendConfirmation,
  handleConfirmRegistration,
  handleLogin,
  handleRefresh,
  handleLogout,
  handleMe,
  handleDeleteAccount,
  handleSocketTicket,
  handleOAuthProviders,
  handleOAuthLogin,
  handleOAuthCallback,
  handleOAuthLogout,
  handleOAuthExchange,
  handleCompleteProfile,
  handleCreateGuardianInvite,
  handleAcceptGuardianInvite,
  handleRemoveGuardianLink,
  handleUpdateProfile,
  handleGetPreferences,
  handleUpdatePreferences,
  handleListMedical,
  handlePutMedical,
  handleSupportRequest,
];
