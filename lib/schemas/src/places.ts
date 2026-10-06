/**
 * Place search and map-preview wire contracts (Google Places proxied by the API).
 */

import { z } from './zod.js';

/** Query for place autocomplete. */
export const placesAutocompleteQuerySchema = z.object({
  q: z.string().min(1).max(200),
});

/** One autocomplete suggestion returned to the client. */
export const placeSuggestionSchema = z
  .object({
    id: z.string().min(1),
    primaryText: z.string().min(1),
    secondaryText: z.string().optional(),
  })
  .strict();

/** `GET /places/autocomplete`. */
export const placesAutocompleteResponseSchema = z
  .object({
    suggestions: z.array(placeSuggestionSchema),
  })
  .strict();

/** Query for resolving a place id. */
export const placesResolveQuerySchema = z.object({
  id: z.string().min(1).max(256),
});

/** Resolved place label and coordinates. */
export const placeDetailsSchema = z
  .object({
    label: z.string().min(1).max(500),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

/** Query for reverse-geocoding or a static map preview. */
export const placesMapQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

/** Query for reverse-geocoding a map pin. */
export const placesReverseQuerySchema = placesMapQuerySchema;

/** Inferred type for {@link placesAutocompleteQuerySchema}. */
export type PlacesAutocompleteQuery = z.infer<typeof placesAutocompleteQuerySchema>;

/** Inferred type for {@link placeSuggestionSchema}. */
export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;

/** Inferred type for {@link placesAutocompleteResponseSchema}. */
export type PlacesAutocompleteResponse = z.infer<typeof placesAutocompleteResponseSchema>;

/** Inferred type for {@link placesResolveQuerySchema}. */
export type PlacesResolveQuery = z.infer<typeof placesResolveQuerySchema>;

/** Inferred type for {@link placeDetailsSchema}. */
export type PlaceDetails = z.infer<typeof placeDetailsSchema>;

/** Inferred type for {@link placesMapQuerySchema}. */
export type PlacesMapQuery = z.infer<typeof placesMapQuerySchema>;

/** Inferred type for {@link placesReverseQuerySchema}. */
export type PlacesReverseQuery = z.infer<typeof placesReverseQuerySchema>;
