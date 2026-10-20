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
import { handleLogin } from './login.js';
import { handleLogout } from './logout.js';
import { handleMe } from './me.js';
import { handleOAuthCallback, handleOAuthLogin, handleOAuthLogout } from './oauth.js';
import { handleOAuthExchange } from './oauth-exchange.js';
import { handleGetPreferences, handleUpdatePreferences } from './preferences.js';
import { handleRefresh } from './refresh.js';
import { handleRegister } from './register.js';
import { handleSocketTicket } from './socket-ticket.js';
import { handleUpdateProfile } from './update-profile.js';

export {
  handleAcceptGuardianInvite,
  handleCompleteProfile,
  handleConfirmRegistration,
  handleCreateGuardianInvite,
  handleGetPreferences,
  handleLogin,
  handleLogout,
  handleMe,
  handleOAuthCallback,
  handleOAuthExchange,
  handleOAuthLogin,
  handleOAuthLogout,
  handleRefresh,
  handleRegister,
  handleRemoveGuardianLink,
  handleResendConfirmation,
  handleSocketTicket,
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
  handleSocketTicket,
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
];
