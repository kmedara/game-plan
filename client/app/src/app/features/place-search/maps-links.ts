/**
 * Builds Apple Maps and Google Maps deep links for an event location.
 */

import type { MappablePlace } from './types';

/** Preferred maps app when opening a place. */
export type MapsProvider = 'apple' | 'google';

/**
 * Builds an Apple Maps URL for the place.
 *
 * @param place - The label and optional coordinates.
 * @returns A `https://maps.apple.com/...` URL.
 */
export const appleMapsUrl = (place: MappablePlace): string => {
  const params = new URLSearchParams();
  params.set('q', place.label);
  if (place.latitude !== undefined && place.longitude !== undefined) {
    params.set('ll', `${place.latitude},${place.longitude}`);
  }
  return `https://maps.apple.com/?${params.toString()}`;
};

/**
 * Builds a Google Maps URL for the place.
 *
 * @param place - The label and optional coordinates.
 * @returns A Google Maps search URL.
 */
export const googleMapsUrl = (place: MappablePlace): string => {
  if (place.latitude !== undefined && place.longitude !== undefined) {
    return `https://www.google.com/maps/search/?api=1&query=${place.latitude}%2C${place.longitude}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.label)}`;
};

/**
 * Opens the place in the preferred maps app.
 *
 * @param place - The label and optional coordinates.
 * @param preferred - Apple Maps or Google Maps.
 */
export const openPlaceInMaps = (place: MappablePlace, preferred: MapsProvider): void => {
  const url = preferred === 'apple' ? appleMapsUrl(place) : googleMapsUrl(place);
  window.open(url, '_blank', 'noopener,noreferrer');
};
