/**
 * Shared place shapes for event location autocomplete.
 */

/** One row in the location autocomplete panel. */
export type PlaceSuggestion = {
  id: string;
  primaryText: string;
  secondaryText?: string;
};

/** Place details stored on a created event. */
export type ResolvedPlace = {
  label: string;
  latitude: number;
  longitude: number;
};

/** Minimal place payload for building map deep links. */
export type MappablePlace = {
  label: string;
  latitude?: number;
  longitude?: number;
};
