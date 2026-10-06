/**
 * Maps teams-area domain errors to HTTP responses.
 */

import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  badRequest,
  conflict,
  type ErrorMappingFn,
  forbidden,
  notFound,
  unauthorized,
  withErrors,
} from "../../../lib/http.js";

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
    case "profile_not_found":
      return notFound();
    case "not_a_member":
    case "forbidden":
      return forbidden();
    case "minor_cannot_create_team":
    case "minor_cannot_be_team_admin":
    case "minor_cannot_hold_manage_permissions":
      return forbidden(error.message);
    case "already_a_member":
    case "join_request_exists":
      return conflict(error.message);
    case "manage_permissions_required_for_team_admin":
    case "invalid_body":
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
 * Runs a teams route and maps known errors; unknown errors become `500`.
 *
 * @param run - The async route body.
 * @returns The route response.
 */
export const withTeamsErrors = (
  run: () => Promise<APIGatewayProxyStructuredResultV2>,
): Promise<APIGatewayProxyStructuredResultV2> => withErrors(run, mapTeamsError);
