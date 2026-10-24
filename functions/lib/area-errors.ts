/**
 * Error codes every area maps the same way.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { conflict, type ErrorMappingFn, forbidden, notFound, unauthorized } from './http.js';

/** Maps one area's own errors; `undefined` leaves the error to the common rules. */
type AreaErrorMapping = (error: Error) => APIGatewayProxyStructuredResultV2 | undefined;

/**
 * Maps a failed sign-in or guard, a missing team, and a failed DynamoDB condition.
 *
 * @param error - The thrown error.
 * @returns A proxy result when the error is one of these, otherwise `undefined`.
 */
const mapCommonError = (error: Error): APIGatewayProxyStructuredResultV2 | undefined => {
  switch (error.message) {
    case 'unauthorized':
    case 'invalid_token':
    case 'token_expired':
      return unauthorized();
    case 'not_a_member':
    case 'forbidden':
      return forbidden();
    case 'team_not_found':
      return notFound();
    default:
      return error.name === 'ConditionalCheckFailedException' ? conflict('condition_failed') : undefined;
  }
};

/**
 * Builds an area's error mapping: its own codes first, then the common ones.
 *
 * A thrown string is read as an error with that message.
 *
 * @param mapArea - The area's own codes.
 * @returns A mapping for `withMappedErrors`.
 */
export const areaErrors =
  (mapArea: AreaErrorMapping): ErrorMappingFn =>
  (thrown) => {
    const error = thrown instanceof Error ? thrown : typeof thrown === 'string' ? new Error(thrown) : undefined;
    if (error === undefined) return undefined;
    return mapArea(error) ?? mapCommonError(error);
  };
