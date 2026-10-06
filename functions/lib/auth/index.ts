/**
 * Auth helpers shared by HTTP handlers and the WebSocket authorizer.
 */

export {
  authenticateRequest,
  getAccessVerifier,
  isCognitoConfigured,
  resetAccessVerifier,
  toAuthUser,
  verifyAccessToken,
  verifyAuthHeader,
} from './cognito.js';

export { requirePermission, requireUser } from './require.js';

export { isAuthDisabled, seedUserId } from './auth-disabled.js';

export {
  buildAuthorizeUrl,
  buildLogoutUrl,
  exchangeAuthorizationCode,
  generateOAuthState,
  generatePkcePair,
  getAuthCallbackUrl,
  getCognitoOAuthConfig,
  readOAuthIdClaims,
  type OAuthIdClaims,
  type OAuthTokens,
} from './oauth.js';

export {
  clearRefreshSetCookie,
  REFRESH_COOKIE,
  REFRESH_DELIVERY_HEADER,
  refreshSetCookie,
  wantsBodyRefreshToken,
} from './refresh-cookie.js';

export {
  toUserProfile,
  type IdentityProvider,
  type IdentityTokens,
  type LoginInput,
  type RegisterInput,
  type UserProfileItem,
} from './identity-provider.js';

export { getIdentityProvider, resetIdentityProvider, setIdentityProvider } from './provider.js';
export { createLocalIdentityProvider } from './local-provider.js';
export { createCognitoIdentityProvider, resetCognitoClient } from './cognito-provider.js';
export {
  issueLocalTokens,
  LOCAL_ACCESS_TTL_SECONDS,
  LOCAL_REFRESH_TTL_SECONDS,
  localJwtSecret,
  signLocalJwt,
  verifyLocalJwt,
  type LocalJwtClaims,
} from './local-jwt.js';
export { findProfileByEmail, getProfile, putProfile } from './profile.js';
