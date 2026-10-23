/**
 * Cognito Hosted UI OAuth routes under `/identity/oauth/*`.
 */

import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  clearRefreshSetCookie,
  configuredSocialProviders,
  exchangeAuthorizationCode,
  generateOAuthState,
  generatePkcePair,
  getProfile,
  putProfile,
  readOAuthIdClaims,
  refreshSetCookie,
  requestedSocialProvider,
} from "../../../lib/auth/index.js";
import { json, readCookie, redirect } from "../../../lib/http.js";
import type { OauthProviders, UserProfile } from "@gameplan/types";
import { errorMessage, functionArea, logError } from "../../../lib/log.js";
import { issueOAuthHandoff } from "../../../lib/oauth-handoff.js";
import { route } from "../../../lib/pipeline.js";
import {
  NATIVE_AUTH_REDIRECT,
  OAUTH_NATIVE_COOKIE,
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  oauthClearCookie,
  oauthSetCookie,
} from "./oauth-cookies.js";

/**
 * Parses an allowlisted return URL for post-login redirects.
 *
 * @param raw - Candidate return URL from the query string or cookie.
 * @returns A safe absolute URL on the client origin.
 */
const resolveReturnTo = (raw: string | undefined): string => {
  const clientOrigin = (
    process.env.CLIENT_ORIGIN ?? "http://localhost:4200"
  ).replace(/\/+$/u, "");
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
 * Handles `GET /identity/oauth/providers`.
 *
 * Public: the login screen asks before anyone is signed in.
 *
 * @returns The social sign-ins this deployment offers.
 */
export const handleOAuthProviders = route("GET", "/identity/oauth/providers", async () =>
  json(200, { providers: configuredSocialProviders() } satisfies OauthProviders),
);

/**
 * Handles `GET /identity/oauth/login`.
 *
 * `provider` sends the browser straight to Apple or Google instead of the
 * Managed login page. An unknown or unconfigured provider falls back to that page.
 *
 * @param event - The HTTP API event.
 * @returns A redirect to Cognito Hosted UI.
 */
export const handleOAuthLogin = route("GET", "/identity/oauth/login", async ({ event }) => {
  const native = event.queryStringParameters?.delivery === "native";
  const returnTo = resolveReturnTo(event.queryStringParameters?.returnTo);
  const provider = requestedSocialProvider(event.queryStringParameters?.provider);
  const state = generateOAuthState();
  const { verifier, challenge } = generatePkcePair();
  const location = buildAuthorizeUrl({ state, challenge, provider });
  return redirect(location, [
    ...oauthSetCookie(OAUTH_STATE_COOKIE, state),
    ...oauthSetCookie(OAUTH_VERIFIER_COOKIE, verifier),
    ...oauthSetCookie(OAUTH_RETURN_COOKIE, returnTo),
    ...oauthSetCookie(OAUTH_NATIVE_COOKIE, native ? "1" : "0"),
  ]);
});

/**
 * Handles `GET /identity/oauth/callback`.
 *
 * @param event - The HTTP API event.
 * @returns A redirect to the website with a refresh cookie, or an error redirect.
 */
export const handleOAuthCallback = route("GET", "/identity/oauth/callback", async ({
  event,
}) => {
  const clientOrigin = (
    process.env.CLIENT_ORIGIN ?? "http://localhost:4200"
  ).replace(/\/+$/u, "");
  const clearHandshake = [
    ...oauthClearCookie(OAUTH_STATE_COOKIE),
    ...oauthClearCookie(OAUTH_VERIFIER_COOKIE),
    ...oauthClearCookie(OAUTH_RETURN_COOKIE),
    ...oauthClearCookie(OAUTH_NATIVE_COOKIE),
  ];

  const code = event.queryStringParameters?.code;
  const state = event.queryStringParameters?.state;
  const error = event.queryStringParameters?.error;
  const expectedState = readCookie(event, OAUTH_STATE_COOKIE);
  const verifier = readCookie(event, OAUTH_VERIFIER_COOKIE);
  const returnTo = resolveReturnTo(readCookie(event, OAUTH_RETURN_COOKIE));
  const native = readCookie(event, OAUTH_NATIVE_COOKIE) === "1";
  const nativeError = (reason: string): APIGatewayProxyStructuredResultV2 =>
    redirect(
      `${NATIVE_AUTH_REDIRECT}?error=${encodeURIComponent(reason)}`,
      clearHandshake,
    );

  if (error) {
    if (native) return nativeError(error);
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
    if (native) return nativeError("invalid_state");
    return redirect(
      `${clientOrigin}/login?error=invalid_state`,
      clearHandshake,
    );
  }

  try {
    const tokens = await exchangeAuthorizationCode({ code, verifier });
    const claims = readOAuthIdClaims(tokens.idToken);
    let profile = await getProfile(claims.userId);
    if (profile === undefined && claims.email !== undefined && claims.email.length > 0) {
      profile = await putProfile({
        userId: claims.userId,
        email: claims.email,
        displayName:
          claims.displayName?.trim() || claims.email.split('@')[0] || 'Player',
        accountKind: 'adult',
      });
    }
    const needsProfile =
      profile === undefined || profile.birthday === undefined;
    const destination = needsProfile
      ? `${clientOrigin}/complete-profile`
      : returnTo;

    if (tokens.refreshToken === undefined) {
      if (native) return nativeError("missing_refresh_token");
      return redirect(
        `${clientOrigin}/login?error=missing_refresh_token`,
        clearHandshake,
      );
    }

    if (native) {
      const handoff = await issueOAuthHandoff(
        tokens.refreshToken,
        needsProfile ? "complete-profile" : "teams",
      );
      return redirect(
        `${NATIVE_AUTH_REDIRECT}?code=${encodeURIComponent(handoff)}`,
        clearHandshake,
      );
    }

    return redirect(destination, [
      ...clearHandshake,
      ...refreshSetCookie(tokens.refreshToken),
    ]);
  } catch (err) {
    logError({
      area: functionArea(),
      route: "GET /identity/oauth/callback",
      msg: errorMessage(err),
      error: err,
    });
    if (native) return nativeError("sign_in_failed");
    return redirect(
      `${clientOrigin}/login?error=sign_in_failed`,
      clearHandshake,
    );
  }
});

/**
 * Handles `GET /identity/oauth/logout`.
 *
 * @param event - The HTTP API event.
 * @returns A redirect that clears the session cookie and sends the browser to Cognito Hosted UI.
 */
export const handleOAuthLogout = route("GET", "/identity/oauth/logout", async ({ event }) => {
  const returnTo = resolveReturnTo(
    event.queryStringParameters?.returnTo ??
      `${(process.env.CLIENT_ORIGIN ?? "http://localhost:4200").replace(/\/+$/u, "")}/login`,
  );
  const clear = clearRefreshSetCookie();

  try {
    return redirect(buildLogoutUrl(returnTo), clear);
  } catch {
    return redirect(returnTo, clear);
  }
});

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
  displayName: displayName ?? "New user",
  accountKind: "adult",
  needsProfileCompletion: true,
});
