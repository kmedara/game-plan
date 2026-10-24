/**
 * Shared session response and error mapping for identity routes.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { accessSetCookie, refreshSetCookie } from '../../../lib/auth/index.js';
import type { SessionTokens, UserProfile } from '@gameplan/types';
import {
  badRequest,
  conflict,
  forbidden,
  json,
  notFound,
  unauthorized,
  withCookies,
} from '../../../lib/http.js';
import { withMappedErrors } from '../../../lib/pipeline.js';

/**
 * Builds a session JSON body.
 *
 * Only the Expo app gets the tokens in JSON. The website gets them as HttpOnly
 * cookies, so script on the page, including injected script, never reads them.
 *
 * @param accessToken - The access JWT.
 * @param expiresIn - Access-token lifetime in seconds.
 * @param user - The public profile.
 * @param refreshToken - The refresh token.
 * @param bodyDelivery - When `true` (native), add both tokens to the JSON.
 * @returns The session response body.
 */
const sessionBody = (
  accessToken: string,
  expiresIn: number,
  user: UserProfile,
  refreshToken: string,
  bodyDelivery: boolean,
): SessionTokens => ({
  expiresIn,
  user,
  ...(bodyDelivery ? { accessToken, refreshToken } : {}),
});

/**
 * Returns a JSON session response and sets the session cookies.
 *
 * The refresh cookie is always set. The website also gets the access cookie.
 *
 * @param statusCode - HTTP status for the response.
 * @param accessToken - The access JWT.
 * @param expiresIn - Access-token lifetime in seconds.
 * @param user - The public profile.
 * @param refreshToken - The refresh token for the cookie (and optional body).
 * @param bodyDelivery - When `true` (native), return both tokens in JSON instead of an access cookie.
 * @returns A structured proxy result with `Set-Cookie`.
 */
export const sessionResponse = (
  statusCode: number,
  accessToken: string,
  expiresIn: number,
  user: UserProfile,
  refreshToken: string,
  bodyDelivery: boolean,
): APIGatewayProxyStructuredResultV2 =>
  withCookies(json(statusCode, sessionBody(accessToken, expiresIn, user, refreshToken, bodyDelivery)), [
    ...refreshSetCookie(refreshToken),
    ...(bodyDelivery ? [] : [accessSetCookie(accessToken, expiresIn)]),
  ]);

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
    case 'profile_already_complete':
    case 'birthday_already_set':
      return conflict(error.message);
    case 'email_not_confirmed':
      return forbidden('email_not_confirmed');
    case 'invalid_confirmation_code':
    case 'confirmation_not_required':
      return badRequest(error.message);
    case 'confirmation_throttled':
      return json(429, { error: 'confirmation_throttled' });
    case 'invalid_credentials':
      return unauthorized('invalid_credentials');
    case 'invalid_token':
    case 'token_expired':
    case 'unauthorized':
      return unauthorized(error.message === 'unauthorized' ? 'unauthorized' : 'invalid_token');
    case 'profile_not_found':
    case 'guardian_not_found':
    case 'guardian_invite_not_found':
      return notFound();
    case 'guardian_invite_minor_only':
    case 'guardian_must_be_adult':
    case 'forbidden':
      return forbidden(error.message === 'forbidden' ? 'forbidden' : error.message);
    case 'guardian_already_linked':
      return conflict('guardian_already_linked');
    case 'guardian_not_linked':
      return badRequest('guardian_not_linked');
    case 'invalid_body':
      return badRequest('invalid_body');
    case 'invalid_photo_key':
      return json(400, { error: 'invalid_photo_key' });
    case 'cognito_not_configured':
      return json(503, { error: 'cognito_not_configured' });
    case 'support_not_configured':
    case 'support_send_failed':
      return json(503, { error: error.message });
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
