/**
 * Maps media route errors to HTTP responses.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { badRequest, forbidden, json, unauthorized } from '../../../lib/http.js';

/**
 * Runs a media route and maps known error codes to HTTP responses.
 *
 * @param run - The route body.
 * @returns The route response.
 */
export const withMediaErrors = async (
  run: () => Promise<APIGatewayProxyStructuredResultV2>,
): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    return await run();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'unauthorized') return unauthorized();
    if (message === 'forbidden') return forbidden();
    if (message === 'invalid_object_key' || message === 'payload_too_large') {
      return badRequest(message);
    }
    if (message === 'media_bucket_not_configured') {
      return json(503, { error: message });
    }
    console.error(error);
    return json(500, { error: 'internal' });
  }
};
