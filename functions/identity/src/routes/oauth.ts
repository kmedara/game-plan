/**
 * Cognito Hosted UI OAuth routes under `/identity/oauth/*`.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  clearRefreshSetCookie,
  exchangeAuthorizationCode,
  generateOAuthState,
  generatePkcePair,
  getProfile,
  isAuthDisabled,
  readOAuthIdClaims,
  refreshSetCookie,
} from '../../../lib/auth/index.js';
import { readCookie, redirect } from '../../../lib/http.js';
import type { UserProfile } from '@gameplan/types';
import {
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  oauthClearCookie,
  oauthSetCookie,
} from './oauth-cookies.js';
import { issueSeedSession } from './seed-session.js';

/**
 * Parses an allowlisted return URL for post-login redirects.
 *
 * @param raw - Candidate return URL from the query string or cookie.
 * @returns A safe absolute URL on the client origin.
 */
const resolveReturnTo = (raw: string | undefined): string => {
  const clientOrigin = (process.env.CLIENT_ORIGIN ?? 'http://localhost:4200').replace(
    /\/+$/u,
    '',
  );
  if (raw === undefined || raw.length === 0) return `${clientOrigin}/schedule`;
  try {
    const url = new URL(raw);
    if (url.origin !== clientOrigin) return `${clientOrigin}/schedule`;
    return url.toString();
  } catch {
    return `${clientOrigin}/schedule`;
  }
};

/**
 * Handles `GET /identity/oauth/login`.
 *
 * @param event - The HTTP API event.
 * @returns A redirect to Cognito Hosted UI, or a seed session redirect when auth is disabled.
 */
export const handleOAuthLogin = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const returnTo = resolveReturnTo(event.queryStringParameters?.returnTo);

  if (isAuthDisabled()) {
    const session = await issueSeedSession();
    return redirect(returnTo, [refreshSetCookie(session.refreshToken)]);
  }

  const state = generateOAuthState();
  const { verifier, challenge } = generatePkcePair();
  const location = buildAuthorizeUrl({ state, challenge });
  return redirect(location, [
    oauthSetCookie(OAUTH_STATE_COOKIE, state),
    oauthSetCookie(OAUTH_VERIFIER_COOKIE, verifier),
    oauthSetCookie(OAUTH_RETURN_COOKIE, returnTo),
  ]);
};

/**
 * Handles `GET /identity/oauth/callback`.
 *
 * @param event - The HTTP API event.
 * @returns A redirect to the website with a refresh cookie, or an error redirect.
 */
export const handleOAuthCallback = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const clientOrigin = (process.env.CLIENT_ORIGIN ?? 'http://localhost:4200').replace(
    /\/+$/u,
    '',
  );
  const clearHandshake = [
    oauthClearCookie(OAUTH_STATE_COOKIE),
    oauthClearCookie(OAUTH_VERIFIER_COOKIE),
    oauthClearCookie(OAUTH_RETURN_COOKIE),
  ];

  if (isAuthDisabled()) {
    const session = await issueSeedSession();
    return redirect(`${clientOrigin}/schedule`, [
      ...clearHandshake,
      refreshSetCookie(session.refreshToken),
    ]);
  }

  const code = event.queryStringParameters?.code;
  const state = event.queryStringParameters?.state;
  const error = event.queryStringParameters?.error;
  const expectedState = readCookie(event, OAUTH_STATE_COOKIE);
  const verifier = readCookie(event, OAUTH_VERIFIER_COOKIE);
  const returnTo = resolveReturnTo(readCookie(event, OAUTH_RETURN_COOKIE));

  if (error) {
    return redirect(
      `${clientOrigin}/login?error=${encodeURIComponent(error)}`,
      clearHandshake,
    );
  }

  if (
    code === undefined ||
    state === undefined ||
    expectedState === undefined ||
    verifier === undefined ||
    state !== expectedState
  ) {
    return redirect(`${clientOrigin}/login?error=invalid_state`, clearHandshake);
  }

  try {
    const tokens = await exchangeAuthorizationCode({ code, verifier });
    const claims = readOAuthIdClaims(tokens.idToken);
    const profile = await getProfile(claims.userId);
    const needsProfile = profile === undefined || profile.birthday === undefined;
    const destination = needsProfile
      ? `${clientOrigin}/complete-profile`
      : returnTo;

    if (tokens.refreshToken === undefined) {
      return redirect(`${clientOrigin}/login?error=missing_refresh_token`, clearHandshake);
    }

    return redirect(destination, [
      ...clearHandshake,
      refreshSetCookie(tokens.refreshToken),
    ]);
  } catch {
    return redirect(`${clientOrigin}/login?error=sign_in_failed`, clearHandshake);
  }
};

/**
 * Handles `GET /identity/oauth/logout`.
 *
 * @param event - The HTTP API event.
 * @returns A redirect that clears the session cookie (and Cognito Hosted UI when enabled).
 */
export const handleOAuthLogout = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const returnTo = resolveReturnTo(
    event.queryStringParameters?.returnTo ??
      `${(process.env.CLIENT_ORIGIN ?? 'http://localhost:4200').replace(/\/+$/u, '')}/login`,
  );
  const clear = [clearRefreshSetCookie()];

  if (isAuthDisabled()) {
    return redirect(returnTo, clear);
  }

  try {
    return redirect(buildLogoutUrl(returnTo), clear);
  } catch {
    return redirect(returnTo, clear);
  }
};

/**
 * Builds a pending-profile payload for authenticated callers without a birthday.
 *
 * @param userId - Cognito `sub`.
 * @param email - Email from the token when present.
 * @param displayName - Display name hint from the token when present.
 * @returns A profile-shaped object marked incomplete.
 */
export const pendingProfile = (
  userId: string,
  email: string | undefined,
  displayName: string | undefined,
): UserProfile => ({
  userId,
  email: email ?? `${userId}@users.local`,
  displayName: displayName ?? 'New user',
  accountKind: 'adult',
  needsProfileCompletion: true,
});
