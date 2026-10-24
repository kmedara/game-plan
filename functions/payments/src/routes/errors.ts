/**
 * Maps payments-area domain errors to HTTP responses.
 */

import { areaErrors } from "../../../lib/area-errors.js";
import { badRequest, conflict, forbidden, json, notFound } from "../../../lib/http.js";
import { withMappedErrors } from "../../../lib/pipeline.js";

/**
 * Maps known domain errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapPaymentsError = areaErrors((error) => {
  switch (error.message) {
    case "charge_not_found":
    case "due_not_found":
      return notFound();
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
      return error.name === "TransactionCanceledException" ? conflict("condition_failed") : undefined;
  }
});

/**
 * Catches payments route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withPaymentsErrors = () => withMappedErrors(mapPaymentsError);
