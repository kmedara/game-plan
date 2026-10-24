/**
 * Maps schedule-area domain errors to HTTP responses.
 */

import { areaErrors } from "../../../lib/area-errors.js";
import { badRequest, conflict, notFound } from "../../../lib/http.js";
import { withMappedErrors } from "../../../lib/pipeline.js";

/**
 * Maps known domain errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapScheduleError = areaErrors((error) => {
  switch (error.message) {
    case "event_not_found":
    case "occurrence_not_found":
    case "fixture_not_found":
    case "carpool_offer_not_found":
    case "signup_slot_not_found":
      return notFound();
    case "invalid_window":
    case "window_too_large":
    case "invalid_from":
    case "invalid_to":
    case "invalid_starts_at":
    case "invalid_ends_at":
    case "invalid_until":
    case "invalid_by_week_day":
    case "invalid_occurrence_starts_at":
    case "invalid_body":
    case "not_a_game":
    case "lineup_member_not_found":
    case "carpool_member_not_found":
    case "carpool_full":
    case "carpool_own_offer":
    case "side_required":
    case "fixture_exists":
    case "recurring_event":
    case "same_team":
    case "fixture_not_proposed":
    case "fixture_not_linked":
    case "event_already_linked":
    case "fixture_locked":
    case "fixture_linked":
    case "signup_full":
    case "signup_member_not_found":
    case "signup_capacity_below_claims":
      return badRequest(error.message);
    case "sport_mismatch":
    case "event_changed":
      return conflict(error.message);
    default:
      return undefined;
  }
});

/**
 * Catches schedule route errors and maps known ones; unknown errors become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withScheduleErrors = () =>
  withMappedErrors(mapScheduleError);
