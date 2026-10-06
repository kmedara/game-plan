/**
 * Google Places / Static Maps client used by the places area.
 *
 * The API key stays on the server (`GOOGLE_MAPS_API_KEY`).
 */

import type { PlaceDetails, PlaceSuggestion } from "@gameplan/schemas";

/** Places Autocomplete (New) HTTP endpoint. */
const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";

type PlacesAutocompleteSuggestion = {
  placePrediction?: {
    placeId?: string;
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
    text?: { text?: string };
  };
};

type PlacesAutocompleteResponse = {
  suggestions?: PlacesAutocompleteSuggestion[];
};

type PlacesDetailsResponse = {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
};

/**
 * Reads the Google Maps / Places API key from the process environment.
 *
 * @returns The key string.
 * @throws When the key is missing.
 */
const requireApiKey = (): string => {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";
  if (key.length === 0) throw new Error("places_not_configured");
  return key;
};

/**
 * Builds a display label from a place name and formatted address.
 *
 * @param name - The place display name.
 * @param address - The formatted address.
 * @returns A single label string.
 */
const buildLabel = (name: string, address: string): string => {
  if (name.length > 0 && address.length > 0 && !address.includes(name)) {
    return `${name}, ${address}`;
  }
  if (name.length > 0) return name;
  if (address.length > 0) return address;
  return "Selected place";
};

/**
 * Autocompletes a partial place query via Places API (New).
 *
 * @param query - The typed query string.
 * @returns Suggestion rows for the client.
 */
export const autocompletePlaces = async (
  query: string,
): Promise<PlaceSuggestion[]> => {
  const apiKey = requireApiKey();
  const response = await fetch(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
    },
    body: JSON.stringify({ input: query }),
  });
  if (!response.ok) throw new Error("places_upstream_error");

  const payload = (await response.json()) as PlacesAutocompleteResponse;
  return (payload.suggestions ?? [])
    .map((row) => {
      const prediction = row.placePrediction;
      const id = prediction?.placeId;
      if (id === undefined || id.length === 0) return undefined;
      const primary =
        prediction?.structuredFormat?.mainText?.text ??
        prediction?.text?.text ??
        id;
      const secondary = prediction?.structuredFormat?.secondaryText?.text;
      return {
        id,
        primaryText: primary,
        ...(secondary !== undefined && secondary.length > 0
          ? { secondaryText: secondary }
          : {}),
      } satisfies PlaceSuggestion;
    })
    .filter((row): row is PlaceSuggestion => row !== undefined);
};

/**
 * Resolves a Google place id to a label and coordinates.
 *
 * @param placeId - The Google place id from autocomplete.
 * @returns Place details for storing on an event.
 */
export const resolvePlace = async (placeId: string): Promise<PlaceDetails> => {
  const apiKey = requireApiKey();
  const fieldMask = "id,displayName,formattedAddress,location";
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  const response = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
  });
  if (response.status === 404) throw new Error("place_not_found");
  if (!response.ok) throw new Error("places_upstream_error");

  const place = (await response.json()) as PlacesDetailsResponse;
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  if (latitude === undefined || longitude === undefined) {
    throw new Error("place_not_found");
  }

  const name = place.displayName?.text?.trim() ?? "";
  const address = place.formattedAddress?.trim() ?? "";
  return {
    label: buildLabel(name, address),
    latitude,
    longitude,
  };
};

type GeocodeResponse = {
  status?: string;
  results?: Array<{
    formatted_address?: string;
  }>;
};

/**
 * Reverse-geocodes coordinates to a display label via the Geocoding API.
 *
 * @param latitude - Latitude in decimal degrees.
 * @param longitude - Longitude in decimal degrees.
 * @returns Place details using the pin coordinates.
 */
export const reverseGeocode = async (
  latitude: number,
  longitude: number,
): Promise<PlaceDetails> => {
  const apiKey = requireApiKey();
  const params = new URLSearchParams({
    latlng: `${latitude},${longitude}`,
    key: apiKey,
  });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
  );
  if (!response.ok) throw new Error("places_upstream_error");

  const payload = (await response.json()) as GeocodeResponse;
  if (payload.status === "ZERO_RESULTS") {
    return {
      label: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      latitude,
      longitude,
    };
  }
  if (payload.status !== "OK") throw new Error("places_upstream_error");

  const address = payload.results?.[0]?.formatted_address?.trim() ?? "";
  return {
    label:
      address.length > 0
        ? address
        : `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
    latitude,
    longitude,
  };
};

/**
 * Fetches a Static Maps PNG centered on the given coordinates.
 *
 * @param latitude - Latitude in decimal degrees.
 * @param longitude - Longitude in decimal degrees.
 * @returns PNG bytes from Google Static Maps.
 */
export const fetchStaticMapPng = async (
  latitude: number,
  longitude: number,
): Promise<Buffer> => {
  const apiKey = requireApiKey();
  const params = new URLSearchParams({
    center: `${latitude},${longitude}`,
    zoom: "15",
    size: "640x360",
    scale: "2",
    maptype: "roadmap",
    markers: `color:red|${latitude},${longitude}`,
    key: apiKey,
  });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`,
  );
  if (!response.ok) throw new Error("places_upstream_error");
  const contentType = response.headers.get("content-type");
  if (contentType === null || !contentType.includes("image")) {
    throw new Error("places_upstream_error");
  }
  return Buffer.from(await response.arrayBuffer());
};
