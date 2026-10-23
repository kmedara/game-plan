/**
 * Cognito Hosted UI OAuth helpers (authorization code + PKCE).
 */

import { createHash, randomBytes } from 'node:crypto';
import type { SocialProvider } from '@gameplan/types';

/** Tokens returned by Cognito's `/oauth2/token` endpoint. */
export type OAuthTokens = {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
};

/** Claims extracted from a Cognito id token for profile bootstrap. */
export type OAuthIdClaims = {
  userId: string;
  email?: string;
  displayName?: string;
};

/**
 * Reads Cognito OAuth settings from the process environment.
 *
 * @returns Client id, Hosted UI host, and scopes.
 * @throws When required Cognito OAuth env vars are missing.
 */
export const getCognitoOAuthConfig = (): {
  clientId: string;
  hostedUiDomain: string;
  scope: string;
} => {
  const clientId = process.env.COGNITO_CLIENT_ID;
  const hostedUiDomain = process.env.COGNITO_HOSTED_UI_DOMAIN;
  if (!clientId || !hostedUiDomain) {
    throw new Error('cognito_not_configured');
  }
  return {
    clientId,
    hostedUiDomain: hostedUiDomain.replace(/^https?:\/\//u, '').replace(/\/+$/u, ''),
    scope: 'openid email profile',
  };
};

/**
 * Absolute OAuth callback URL registered on the Cognito app client.
 *
 * @returns The redirect URI used for authorize and token exchange.
 */
export const getAuthCallbackUrl = (): string =>
  process.env.AUTH_CALLBACK_URL ?? 'http://localhost:4200/api/identity/oauth/callback';

/**
 * Builds a cryptographically random OAuth `state` value.
 *
 * @returns A base64url state string.
 */
export const generateOAuthState = (): string => randomBytes(24).toString('base64url');

/**
 * Builds a PKCE verifier and S256 challenge pair.
 *
 * @returns The verifier (cookie) and challenge (authorize URL).
 */
export const generatePkcePair = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

/** Cognito's name for each social identity provider on the user pool. */
const COGNITO_PROVIDER_NAMES: Record<SocialProvider, string> = {
  apple: 'SignInWithApple',
  google: 'Google',
  facebook: 'Facebook',
};

/**
 * Social providers the user pool has, from `AUTH_SOCIAL_PROVIDERS`.
 *
 * The infrastructure sets the list from the credentials it configured, so a
 * provider never shows on the login screen without a working pool connection.
 *
 * @returns Configured providers, in the order the login screen shows them.
 */
export const configuredSocialProviders = (): SocialProvider[] =>
  (process.env.AUTH_SOCIAL_PROVIDERS ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is SocialProvider => Object.hasOwn(COGNITO_PROVIDER_NAMES, part));

/**
 * Reads a requested provider, keeping it only when the pool has it.
 *
 * @param raw - The `provider` query value.
 * @returns The provider, or `undefined` for the Managed login page.
 */
export const requestedSocialProvider = (raw: string | undefined): SocialProvider | undefined =>
  configuredSocialProviders().find((provider) => provider === raw);

/**
 * Builds the Cognito Hosted UI authorize URL.
 *
 * With a provider, Cognito skips its own page and goes straight to Apple or Google.
 *
 * @param input - OAuth state, PKCE challenge, and an optional social provider.
 * @returns An absolute authorize URL.
 */
export const buildAuthorizeUrl = (input: {
  state: string;
  challenge: string;
  provider?: SocialProvider;
}): string => {
  const config = getCognitoOAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    scope: config.scope,
    redirect_uri: getAuthCallbackUrl(),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
  });
  if (input.provider !== undefined) params.set('identity_provider', COGNITO_PROVIDER_NAMES[input.provider]);
  return `https://${config.hostedUiDomain}/oauth2/authorize?${params.toString()}`;
};

/**
 * Builds the Cognito Hosted UI logout URL.
 *
 * @param logoutUri - Registered logout URL (website origin path).
 * @returns An absolute logout URL.
 */
export const buildLogoutUrl = (logoutUri: string): string => {
  const config = getCognitoOAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: logoutUri,
  });
  return `https://${config.hostedUiDomain}/logout?${params.toString()}`;
};

/**
 * Exchanges an authorization code for Cognito tokens.
 *
 * @param input - Authorization code and PKCE verifier.
 * @returns Id, access, and optional refresh tokens.
 */
export const exchangeAuthorizationCode = async (input: {
  code: string;
  verifier: string;
}): Promise<OAuthTokens> => {
  const config = getCognitoOAuthConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code: input.code,
    redirect_uri: getAuthCallbackUrl(),
    code_verifier: input.verifier,
  });

  const response = await fetch(`https://${config.hostedUiDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error('oauth_token_exchange_failed');
  }

  const payload = (await response.json()) as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!payload.id_token || !payload.access_token) {
    throw new Error('oauth_token_exchange_failed');
  }

  return {
    idToken: payload.id_token,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in ?? 3600,
  };
};

/**
 * Decodes the payload of a JWT without verifying the signature.
 *
 * Cognito tokens are verified separately with {@link CognitoJwtVerifier}.
 *
 * @param token - A compact JWT.
 * @returns The JSON payload object.
 */
export const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const parts = token.split('.');
  if (parts.length < 2 || parts[1] === undefined) throw new Error('invalid_token');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
};

/**
 * Reads user id, email, and display name from a Cognito id token payload.
 *
 * @param idToken - The Cognito id token from the code exchange.
 * @returns Claims used to bootstrap a profile.
 */
export const readOAuthIdClaims = (idToken: string): OAuthIdClaims => {
  const payload = decodeJwtPayload(idToken);
  const userId = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (userId === undefined || userId.length === 0) throw new Error('invalid_token');
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const given = typeof payload.given_name === 'string' ? payload.given_name : '';
  const family = typeof payload.family_name === 'string' ? payload.family_name : '';
  const combined = `${given} ${family}`.trim();
  const name = typeof payload.name === 'string' ? payload.name : undefined;
  const username =
    typeof payload['cognito:username'] === 'string' ? payload['cognito:username'] : undefined;
  const displayName =
    usableDisplayName(combined, userId) ??
    usableDisplayName(name, userId) ??
    usableDisplayName(username, userId);
  return { userId, email, displayName };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keeps a human name and drops Cognito ids that social sign-in stores as the username.
 *
 * @param value - A name claim or stored display name.
 * @param userId - The Cognito `sub`, which must not be shown as a name.
 * @returns The trimmed name, or `undefined` when the value is an id.
 */
export const usableDisplayName = (
  value: string | undefined,
  userId: string | undefined,
): string | undefined => {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  if (userId !== undefined && trimmed === userId) return undefined;
  if (UUID_PATTERN.test(trimmed)) return undefined;
  if (/^(Google|Facebook|SignInWithApple|LoginWithAmazon)_/i.test(trimmed)) return undefined;
  return trimmed;
};
