/**
 * Place autocomplete, resolve, reverse-geocode, and static map preview routes.
 */

import {
  placesAutocompleteQuerySchema,
  placesMapQuerySchema,
  placesResolveQuerySchema,
  placesReverseQuerySchema,
} from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { binary, json } from '../../../lib/http.js';
import { route, withQueryValidation } from '../../../lib/pipeline.js';
import {
  autocompletePlaces,
  fetchStaticMapPng,
  resolvePlace,
  reverseGeocode,
} from '../google-places.js';
import { withPlacesErrors } from './errors.js';

/**
 * Handles `GET /places/autocomplete?q=`.
 *
 * @param event - The HTTP API event.
 * @returns Suggestion rows for the typed query.
 */
export const handleAutocomplete = route(
  withPlacesErrors(),
  withQueryValidation(placesAutocompleteQuerySchema),
  requireUser(),
  async ({ query }) => {
    const suggestions = await autocompletePlaces(query.q);
    return json(200, { suggestions });
  },
);

/**
 * Handles `GET /places/resolve?id=`.
 *
 * @param event - The HTTP API event.
 * @returns Label and coordinates for the place id.
 */
export const handleResolve = route(
  withPlacesErrors(),
  withQueryValidation(placesResolveQuerySchema),
  requireUser(),
  async ({ query }) => {
    const place = await resolvePlace(query.id);
    return json(200, place);
  },
);

/**
 * Handles `GET /places/reverse?latitude=&longitude=`.
 *
 * @param event - The HTTP API event.
 * @returns Label and coordinates for a map pin.
 */
export const handleReverse = route(
  withPlacesErrors(),
  withQueryValidation(placesReverseQuerySchema),
  requireUser(),
  async ({ query }) => {
    const place = await reverseGeocode(query.latitude, query.longitude);
    return json(200, place);
  },
);

/**
 * Handles `GET /places/map?latitude=&longitude=`.
 *
 * @param event - The HTTP API event.
 * @returns A PNG map preview (base64-encoded for API Gateway).
 */
export const handleMapPreview = route(
  withPlacesErrors(),
  withQueryValidation(placesMapQuerySchema),
  requireUser(),
  async ({ query }) => {
    const png = await fetchStaticMapPng(query.latitude, query.longitude);
    return binary(200, 'image/png', png);
  },
);
