/**
 * Apple Maps and Google Maps links for an event location.
 */

export type MapsProvider = 'apple' | 'google';

export type MappablePlace = {
  label: string;
  latitude?: number;
  longitude?: number;
};

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
 * URL for the preferred maps app.
 *
 * @param place - The label and optional coordinates.
 * @param preferred - Apple Maps or Google Maps.
 * @returns The maps URL.
 */
export const mapsUrl = (place: MappablePlace, preferred: MapsProvider): string =>
  preferred === 'apple' ? appleMapsUrl(place) : googleMapsUrl(place);
