/**
 * Maps media route errors to HTTP responses.
 */

import { areaErrors } from '../../../lib/area-errors.js';
import { badRequest, json } from '../../../lib/http.js';
import { withMappedErrors } from '../../../lib/pipeline.js';

/**
 * Maps known media errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapMediaError = areaErrors((error) => {
  switch (error.message) {
    case 'invalid_object_key':
    case 'payload_too_large':
      return badRequest(error.message);
    case 'media_bucket_not_configured':
      return json(503, { error: error.message });
    default:
      return undefined;
  }
});

/**
 * Catches media route errors. Unknown errors are logged and become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withMediaErrors = () => withMappedErrors(mapMediaError);
