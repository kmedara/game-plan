/**
 * Maps billing-area domain errors to HTTP responses.
 */

import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { mapPlanError } from "../../../lib/entitlements.js";
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
export const mapBillingError: ErrorMappingFn = (
  error: unknown,
): APIGatewayProxyStructuredResultV2 | undefined => {
  const plan = mapPlanError(error);
  if (plan !== undefined) return plan;
  if (!(error instanceof Error)) return undefined;
  switch (error.message) {
    case "unauthorized":
    case "invalid_token":
    case "token_expired":
      return unauthorized();
    case "team_not_found":
    case "no_billing_account":
      return notFound();
    case "not_a_member":
    case "forbidden":
      return forbidden();
    case "invalid_signature":
      return badRequest(error.message);
    case "already_subscribed":
    case "managed_by_organization":
      return conflict(error.message);
    case "billing_not_configured":
      return json(503, { error: "billing_not_configured" });
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
 * Catches billing route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withBillingErrors = () => withMappedErrors(mapBillingError);
