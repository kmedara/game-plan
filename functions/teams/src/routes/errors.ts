/**
 * Maps teams-area domain errors to HTTP responses.
 */

import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  badRequest,
  conflict,
  type ErrorMappingFn,
  forbidden,
  json,
  notFound,
  unauthorized,
} from "../../../lib/http.js";
import { withMappedErrors } from "../../../lib/pipeline.js";

/**
 * Maps known domain errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapTeamsError: ErrorMappingFn = (
  error: unknown,
): APIGatewayProxyStructuredResultV2 | undefined => {
  if (!(error instanceof Error)) return undefined;
  switch (error.message) {
    case "unauthorized":
    case "invalid_token":
    case "token_expired":
      return unauthorized();
    case "team_not_found":
    case "invite_not_found":
    case "join_request_not_found":
    case "member_not_found":
    case "profile_not_found":
      return notFound();
    case "not_a_member":
    case "forbidden":
      return forbidden();
    case "minor_cannot_create_team":
    case "minor_cannot_be_team_admin":
    case "minor_cannot_hold_manage_permissions":
    case "role_outranks_caller":
      return forbidden(error.message);
    case "already_a_member":
    case "join_request_exists":
    case "recipient_opted_out":
      return conflict(error.message);
    case "invalid_recipient":
    case "text_country_unsupported":
      return badRequest(error.message);
    case "invite_send_limit":
      return json(429, { error: error.message });
    // The app falls back to the person's own mail or messages app.
    case "email_not_configured":
    case "text_not_configured":
      return json(503, { error: error.message });
    case "invite_send_failed":
      return json(502, { error: error.message });
    case "manage_permissions_required_for_team_admin":
    case "team_admin_permissions_locked":
    case "roles_required":
    case "invalid_body":
    case "too_many_positions":
      return badRequest(error.message);
    case "TransactionCanceledException":
      return conflict("transaction_conflict");
    default:
      if (error.name === "ConditionalCheckFailedException") {
        return conflict("condition_failed");
      }
      if (error.name === "TransactionCanceledException") {
        return conflict("transaction_conflict");
      }
      return undefined;
  }
};

/**
 * Catches teams route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withTeamsErrors = () =>
  withMappedErrors(mapTeamsError);
