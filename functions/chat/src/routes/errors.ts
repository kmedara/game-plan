/**
 * Maps chat-area domain errors to HTTP responses.
 */

import { areaErrors } from '../../../lib/area-errors.js';
import { badRequest, conflict, forbidden, json, notFound } from '../../../lib/http.js';
import { withMappedErrors } from '../../../lib/pipeline.js';

/**
 * Maps known domain errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapChatError = areaErrors((error) => {
  switch (error.message) {
    case 'user_not_found':
      return json(404, { error: 'user_not_found' });
    case 'chat_not_found':
    case 'profile_not_found':
    case 'poll_not_found':
      return notFound();
    case 'not_a_chat_member':
      return forbidden();
    case 'minor_chat_rule_violated':
    case 'guardian_required':
      return forbidden(error.message);
    case 'invalid_body':
    case 'invalid_attachment_key':
    case 'poll_closed':
    case 'poll_option_not_found':
    case 'poll_single_choice':
    case 'poll_duplicate_option':
      return badRequest(error.message);
    default:
      return error.name === 'TransactionCanceledException' ? conflict('transaction_conflict') : undefined;
  }
});

/**
 * Catches chat route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withChatErrors = () => withMappedErrors(mapChatError);
