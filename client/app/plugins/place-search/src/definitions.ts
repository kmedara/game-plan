/**
 * Place search contracts shared by the native plugin and the web stub.
 */

/** One autocomplete row shown while the user types. */
export type PlaceSuggestion = {
  /** Opaque id passed back to {@link PlaceSearchPlugin.resolve}. */
  id: string;
  /** Primary label (place name or street). */
  primaryText: string;
  /** Secondary label (city, region, or address detail). */
  secondaryText?: string;
};

/** Resolved place used when saving an event location. */
export type ResolvedPlace = {
  /** Display label stored on the event. */
  label: string;
  /** Latitude in decimal degrees. */
  latitude: number;
  /** Longitude in decimal degrees. */
  longitude: number;
};

/** Capacitor bridge for platform-native place search. */
export interface PlaceSearchPlugin {
  /**
   * Returns autocomplete suggestions for a partial query.
   *
   * @param options - The typed query string.
   */
  autocomplete(options: { query: string }): Promise<{ suggestions: PlaceSuggestion[] }>;

  /**
   * Resolves a suggestion id to a label and coordinates.
   *
   * @param options - The suggestion id from {@link autocomplete}.
   */
  resolve(options: { id: string }): Promise<ResolvedPlace>;
}
