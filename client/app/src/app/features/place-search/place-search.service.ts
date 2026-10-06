/**
 * Place autocomplete and reverse geocode via the product API.
 */

import { Injectable, inject } from '@angular/core';
import { ApiClientService } from '../../core/api-client.service';
import type { PlaceSuggestion, ResolvedPlace } from './types';

/** Debounce window for autocomplete while the user types. */
const AUTOCOMPLETE_DEBOUNCE_MS = 300;

@Injectable({ providedIn: 'root' })
export class PlaceSearchService {
  private readonly api = inject(ApiClientService);
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private debounceGeneration = 0;

  /**
   * Debounced autocomplete for the location field.
   *
   * @param query - The partial place text.
   * @returns Suggestions for the autocomplete panel.
   */
  autocomplete(query: string): Promise<PlaceSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return Promise.resolve([]);

    const generation = ++this.debounceGeneration;
    return new Promise((resolve) => {
      if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        void this.api
          .autocompletePlaces(trimmed)
          .then((suggestions) => {
            if (generation === this.debounceGeneration) resolve(suggestions);
          })
          .catch(() => {
            if (generation === this.debounceGeneration) resolve([]);
          });
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    });
  }

  /**
   * Resolves a suggestion into a label and coordinates.
   *
   * @param id - The suggestion id from {@link autocomplete}.
   * @returns The place details to store on the event.
   */
  async resolve(id: string): Promise<ResolvedPlace> {
    return this.api.resolvePlace(id);
  }

  /**
   * Reverse-geocodes a map pin into a label and coordinates.
   *
   * @param latitude - Latitude in decimal degrees.
   * @param longitude - Longitude in decimal degrees.
   * @returns The place details to store on the event.
   */
  async reverse(latitude: number, longitude: number): Promise<ResolvedPlace> {
    return this.api.reverseGeocodePlace(latitude, longitude);
  }
}
