/**
 * Web stub: native MapKit / Places SDK are unavailable in the browser.
 * The Angular PlaceSearchService uses the Places REST API on web instead.
 */

import { WebPlugin } from '@capacitor/core';
import type { PlaceSearchPlugin, PlaceSuggestion, ResolvedPlace } from './definitions';

/** No-op web implementation; callers should use the Places REST path on web. */
export class PlaceSearchWeb extends WebPlugin implements PlaceSearchPlugin {
  /**
   * Returns no suggestions on web.
   *
   * @returns An empty suggestion list.
   */
  async autocomplete(_options: { query: string }): Promise<{ suggestions: PlaceSuggestion[] }> {
    return { suggestions: [] };
  }

  /**
   * Rejects resolve on web; the Angular service handles web place details.
   *
   * @returns Never resolves successfully on web.
   */
  async resolve(_options: { id: string }): Promise<ResolvedPlace> {
    throw this.unimplemented('PlaceSearch.resolve is not available on web.');
  }
}
