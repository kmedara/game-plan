/**
 * Maps places-area domain errors to HTTP responses.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  type ErrorMappingFn,
  forbidden,
  json,
  unauthorized,
} from '../../../lib/http.js';
import { withMappedErrors } from '../../../lib/pipeline.js';

/**
 * Maps known places errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapPlacesError: ErrorMappingFn = (
  error: unknown,
): APIGatewayProxyStructuredResultV2 | undefined => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'unauthorized') return unauthorized();
  if (message === 'forbidden') return forbidden();
  if (message === 'place_not_found') return json(404, { error: message });
  if (message === 'places_not_configured') {
    return json(503, { error: message });
  }
  if (message === 'places_upstream_error') {
    return json(502, { error: message });
  }
  return undefined;
};

/**
 * Catches places route errors. Unknown errors are logged and become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withPlacesErrors = () =>
  withMappedErrors(mapPlacesError, {
    onUnmapped: (error) => {
      console.error(error);
    },
    fallback: () => json(500, { error: 'internal' }),
  });
