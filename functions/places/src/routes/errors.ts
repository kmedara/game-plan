/**
 * Maps places-area domain errors to HTTP responses.
 */

import { areaErrors } from '../../../lib/area-errors.js';
import { json } from '../../../lib/http.js';
import { withMappedErrors } from '../../../lib/pipeline.js';

/**
 * Maps known places errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapPlacesError = areaErrors((error) => {
  switch (error.message) {
    case 'place_not_found':
      return json(404, { error: error.message });
    case 'places_not_configured':
      return json(503, { error: error.message });
    case 'places_upstream_error':
      return json(502, { error: error.message });
    default:
      return undefined;
  }
});

/**
 * Catches places route errors. Unknown errors are logged and become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withPlacesErrors = () => withMappedErrors(mapPlacesError);
