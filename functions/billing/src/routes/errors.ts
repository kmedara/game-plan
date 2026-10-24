/**
 * Maps billing-area domain errors to HTTP responses.
 */

import { areaErrors } from "../../../lib/area-errors.js";
import { mapPlanError } from "../../../lib/entitlements.js";
import { badRequest, conflict, json, notFound } from "../../../lib/http.js";
import { withMappedErrors } from "../../../lib/pipeline.js";

/**
 * Maps known domain errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapBillingError = areaErrors((error) => {
  const plan = mapPlanError(error);
  if (plan !== undefined) return plan;
  switch (error.message) {
    case "org_not_found":
    case "no_billing_account":
      return notFound();
    case "invalid_signature":
      return badRequest(error.message);
    case "already_subscribed":
    case "managed_by_organization":
      return conflict(error.message);
    case "billing_not_configured":
      return json(503, { error: "billing_not_configured" });
    default:
      return error.name === "TransactionCanceledException" ? conflict("condition_failed") : undefined;
  }
});

/**
 * Catches billing route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withBillingErrors = () => withMappedErrors(mapBillingError);
