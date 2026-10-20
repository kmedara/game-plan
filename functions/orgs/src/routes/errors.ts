/**
 * Maps organization errors to HTTP responses.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { mapPlanError } from '../../../lib/entitlements.js';
import { badRequest, conflict, type ErrorMappingFn, forbidden, json, notFound, unauthorized } from '../../../lib/http.js';
import { withMappedErrors } from '../../../lib/pipeline.js';

/**
 * Maps known domain errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapOrgsError: ErrorMappingFn = (error: unknown): APIGatewayProxyStructuredResultV2 | undefined => {
  if (!(error instanceof Error)) return undefined;
  const plan = mapPlanError(error);
  if (plan !== undefined) return plan;
  switch (error.message) {
    case 'unauthorized':
    case 'invalid_token':
    case 'token_expired':
      return unauthorized();
    case 'org_not_found':
    case 'team_not_found':
    case 'user_not_found':
    case 'invite_not_found':
      return notFound();
    case 'not_a_member':
    case 'forbidden':
      return forbidden();
    case 'minor_cannot_own_organization':
    case 'org_admin_must_be_adult':
      return forbidden(error.message);
    case 'owner_cannot_leave':
    case 'too_many_admins':
    case 'too_many_teams':
      return badRequest(error.message);
    case 'already_in_organization':
    case 'team_in_another_organization':
      return conflict(error.message);
    case 'billing_not_configured':
      return json(503, { error: 'billing_not_configured' });
    default:
      if (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException') {
        return conflict('condition_failed');
      }
      return undefined;
  }
};

/**
 * Catches organization route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withOrgsErrors = () => withMappedErrors(mapOrgsError);
