/**
 * Maps teams-area domain errors to HTTP responses.
 */

import { areaErrors } from "../../../lib/area-errors.js";
import { mapPlanError } from "../../../lib/entitlements.js";
import { badRequest, conflict, forbidden, json, notFound } from "../../../lib/http.js";
import { withMappedErrors } from "../../../lib/pipeline.js";

/**
 * Maps known domain errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapTeamsError = areaErrors((error) => {
  const plan = mapPlanError(error);
  if (plan !== undefined) return plan;
  switch (error.message) {
    case "waiver_not_found":
    case "template_not_found":
    case "signature_not_found":
      return notFound();
    case "not_signer":
      return forbidden(error.message);
    case "member_not_asked":
    case "too_many_waivers":
      return badRequest(error.message);
    case "waiver_archived":
    case "waiver_changed":
    case "already_signed":
    case "signed_in_app":
      return conflict(error.message);
    case "pdf_link_expired":
      return json(410, { error: error.message });
    case "invite_not_found":
    case "join_request_not_found":
    case "member_not_found":
    case "profile_not_found":
      return notFound();
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
      return error.name === "TransactionCanceledException" ? conflict("transaction_conflict") : undefined;
  }
});

/**
 * Catches teams route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withTeamsErrors = () =>
  withMappedErrors(mapTeamsError);
