/**
 * Maps chat-area domain errors to HTTP responses.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  badRequest,
  conflict,
  forbidden,
  json,
  notFound,
  unauthorized,
} from '../../../lib/http.js';
import { withMappedErrors } from '../../../lib/pipeline.js';

/**
 * Maps known domain errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapChatError = (
  error: unknown,
): APIGatewayProxyStructuredResultV2 | undefined => {
  if (!(error instanceof Error)) return undefined;
  switch (error.message) {
    case 'unauthorized':
    case 'invalid_token':
    case 'token_expired':
      return unauthorized();
    case 'user_not_found':
      return json(404, { error: 'user_not_found' });
    case 'team_not_found':
    case 'chat_not_found':
    case 'profile_not_found':
      return notFound();
    case 'not_a_member':
    case 'not_a_chat_member':
    case 'forbidden':
      return forbidden();
    case 'minor_chat_rule_violated':
      return forbidden(error.message);
    case 'invalid_body':
      return badRequest(error.message);
    default:
      if (error.name === 'ConditionalCheckFailedException') {
        return conflict('condition_failed');
      }
      if (error.name === 'TransactionCanceledException') {
        return conflict('transaction_conflict');
      }
      return undefined;
  }
};

/**
 * Catches chat route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withChatErrors = () => withMappedErrors(mapChatError);

