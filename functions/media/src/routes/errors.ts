/**
 * Maps media route errors to HTTP responses.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  badRequest,
  type ErrorMappingFn,
  forbidden,
  json,
  unauthorized,
} from '../../../lib/http.js';
import { withMappedErrors } from '../../../lib/pipeline.js';

/**
 * Maps known media errors to structured HTTP responses.
 *
 * @param error - The thrown value.
 * @returns A proxy result when the error is known, otherwise `undefined`.
 */
export const mapMediaError: ErrorMappingFn = (
  error: unknown,
): APIGatewayProxyStructuredResultV2 | undefined => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'unauthorized') return unauthorized();
  if (message === 'forbidden') return forbidden();
  if (message === 'invalid_object_key' || message === 'payload_too_large') {
    return badRequest(message);
  }
  if (message === 'media_bucket_not_configured') {
    return json(503, { error: message });
  }
  return undefined;
};

/**
 * Catches media route errors. Unknown errors are logged and become `500`.
 *
 * @returns A pipeline step that leaves the context unchanged.
 */
export const withMediaErrors = () =>
  withMappedErrors(mapMediaError, {
    onUnmapped: (error) => {
      console.error(error);
    },
    fallback: () => json(500, { error: 'internal' }),
  });
