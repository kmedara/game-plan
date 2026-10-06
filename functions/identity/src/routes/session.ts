/**
 * Shared session response and error mapping for identity routes.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { refreshSetCookie } from '../../../lib/auth/index.js';
import type { SessionTokens, UserProfile } from '@gameplan/types';
import { conflict, json, notFound, unauthorized, withCookies } from '../../../lib/http.js';
import { withMappedErrors } from '../../../lib/pipeline.js';

/**
 * Builds a session JSON body, optionally including the refresh token.
 *
 * @param accessToken - The access JWT.
 * @param expiresIn - Access-token lifetime in seconds.
 * @param user - The public profile.
 * @param refreshToken - The refresh token.
 * @param includeRefreshInBody - When `true`, add `refreshToken` to the JSON.
 * @returns The session response body.
 */
const sessionBody = (
  accessToken: string,
  expiresIn: number,
  user: UserProfile,
  refreshToken: string,
  includeRefreshInBody: boolean,
): SessionTokens => ({
  accessToken,
  expiresIn,
  user,
  ...(includeRefreshInBody ? { refreshToken } : {}),
});

/**
 * Returns a JSON session response and sets the refresh cookie.
 *
 * @param statusCode - HTTP status for the response.
 * @param accessToken - The access JWT.
 * @param expiresIn - Access-token lifetime in seconds.
 * @param user - The public profile.
 * @param refreshToken - The refresh token for the cookie (and optional body).
 * @param includeRefreshInBody - When `true`, include `refreshToken` in JSON.
 * @returns A structured proxy result with `Set-Cookie`.
 */
export const sessionResponse = (
  statusCode: number,
  accessToken: string,
  expiresIn: number,
  user: UserProfile,
  refreshToken: string,
  includeRefreshInBody: boolean,
): APIGatewayProxyStructuredResultV2 =>
  withCookies(
    json(
      statusCode,
      sessionBody(accessToken, expiresIn, user, refreshToken, includeRefreshInBody),
    ),
    [refreshSetCookie(refreshToken)],
  );

/**
 * Maps provider and domain errors to HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A structured proxy result when the error is known, otherwise `undefined`.
 */
export const mapError = (error: unknown): APIGatewayProxyStructuredResultV2 | undefined => {
  if (!(error instanceof Error)) return undefined;
  switch (error.message) {
    case 'email_taken':
      return conflict('email_taken');
    case 'invalid_credentials':
      return unauthorized('invalid_credentials');
    case 'invalid_token':
    case 'token_expired':
    case 'unauthorized':
      return unauthorized(error.message === 'unauthorized' ? 'unauthorized' : 'invalid_token');
    case 'profile_not_found':
      return notFound();
    case 'invalid_photo_key':
      return json(400, { error: 'invalid_photo_key' });
    case 'seed_user_id_required':
      return json(500, { error: 'seed_user_id_required' });
    case 'cognito_not_configured':
      return json(503, { error: 'cognito_not_configured' });
    default:
      return undefined;
  }
};

/**
 * Catches identity route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withIdentityErrors = () => withMappedErrors(mapError);
