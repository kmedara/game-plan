/**
 * Cognito access-token verification for area Lambdas and the WebSocket authorizer.
 *
 * HTTP routes reach the functions through CloudFront and Lambda function URLs,
 * which do not check the token. Each protected route verifies it here.
 *
 * When Cognito env vars are unset, local HS256 access tokens are accepted so
 * laptop work does not need a cloud deploy.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { AuthUser } from '@gameplan/types';
import { authorizationOf } from '../http.js';
import { verifyLocalJwt } from './local-jwt.js';

/** Cached Cognito JWT verifier for warm invocations. */
type AccessVerifier = ReturnType<typeof CognitoJwtVerifier.create>;

/** Module-scoped verifier so JWKS is not refetched on every request. */
let accessVerifier: AccessVerifier | undefined;

/**
 * Returns whether Cognito is configured for this process.
 *
 * @returns `true` when both pool and client ids are present.
 */
export const isCognitoConfigured = (): boolean =>
  process.env.COGNITO_USER_POOL_ID !== undefined &&
  process.env.COGNITO_CLIENT_ID !== undefined;

/**
 * Reads the Cognito user pool and app client ids from the process environment.
 *
 * @returns The verifier configuration.
 * @throws When either id is missing.
 */
const verifierConfig = (): { userPoolId: string; clientId: string } => {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (userPoolId === undefined || clientId === undefined) {
    throw new Error('cognito_not_configured');
  }
  return { userPoolId, clientId };
};

/**
 * Returns a Cognito access-token verifier for the configured pool and client.
 *
 * @returns A verifier that checks access tokens.
 */
export const getAccessVerifier = (): AccessVerifier => {
  if (accessVerifier !== undefined) return accessVerifier;
  const { userPoolId, clientId } = verifierConfig();
  accessVerifier = CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: 'access',
  });
  return accessVerifier;
};

/**
 * Clears the cached verifier. Used by tests that change Cognito env vars.
 */
export const resetAccessVerifier = (): void => {
  accessVerifier = undefined;
};

/**
 * Maps a verified JWT payload to the shared auth user shape.
 *
 * @param payload - Claims from a verified Cognito access or id token.
 * @returns The caller identity used by area handlers.
 */
export const toAuthUser = (payload: { sub: string; email?: unknown }): AuthUser => ({
  userId: payload.sub,
  email: typeof payload.email === 'string' ? payload.email : undefined,
});

/**
 * Verifies a raw access token (Cognito in the cloud, local HS256 on the laptop).
 *
 * @param token - The JWT string without a `Bearer ` prefix.
 * @returns The authenticated user.
 * @throws When the token is invalid.
 */
export const verifyAccessToken = async (token: string): Promise<AuthUser> => {
  if (!isCognitoConfigured()) {
    const claims = verifyLocalJwt(token);
    if (claims.token_use !== 'access') throw new Error('unauthorized');
    return toAuthUser(claims);
  }
  return toAuthUser(await getAccessVerifier().verify(token));
};

/**
 * Verifies an `Authorization: Bearer <token>` header value.
 *
 * @param authorization - The full header value, or `undefined` when absent.
 * @returns The authenticated user.
 * @throws When the header is missing, malformed, or the token is invalid.
 */
export const verifyAuthHeader = async (authorization?: string): Promise<AuthUser> => {
  if (authorization === undefined || !authorization.startsWith('Bearer ')) {
    throw new Error('unauthorized');
  }
  return verifyAccessToken(authorization.slice('Bearer '.length));
};

/**
 * Resolves the caller from an HTTP event by verifying its bearer token.
 *
 * @param event - The HTTP event.
 * @returns The authenticated user.
 * @throws When no valid token is present.
 */
export const authenticateRequest = async (
  event: APIGatewayProxyEventV2,
): Promise<AuthUser> => verifyAuthHeader(authorizationOf(event));
