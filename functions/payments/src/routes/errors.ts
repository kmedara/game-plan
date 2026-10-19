/**
 * Maps payments-area domain errors to HTTP responses.
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
export const mapPaymentsError: ErrorMappingFn = (
  error: unknown,
): APIGatewayProxyStructuredResultV2 | undefined => {
  if (!(error instanceof Error)) return undefined;
  switch (error.message) {
    case "unauthorized":
    case "invalid_token":
    case "token_expired":
      return unauthorized();
    case "team_not_found":
    case "charge_not_found":
    case "due_not_found":
      return notFound();
    case "not_a_member":
    case "forbidden":
    case "not_payer":
      return forbidden();
    case "member_not_on_team":
    case "invalid_signature":
    case "invalid_body":
      return badRequest(error.message);
    case "payments_not_enabled":
    case "due_settled":
    case "paid_in_app":
      return conflict(error.message);
    case "payments_not_configured":
      return json(503, { error: "payments_not_configured" });
    default:
      if (
        error.name === "ConditionalCheckFailedException" ||
        error.name === "TransactionCanceledException"
      ) {
        return conflict("condition_failed");
      }
      return undefined;
  }
};

/**
 * Catches payments route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withPaymentsErrors = () => withMappedErrors(mapPaymentsError);
