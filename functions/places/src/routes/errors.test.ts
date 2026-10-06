/**
 * Places error mapper coverage.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { route } from '../../../lib/pipeline.js';
import { mapPlacesError, withPlacesErrors } from './errors.js';

describe('mapPlacesError', () => {
  it('maps string and Error values', () => {
    expect(mapPlacesError(new Error('unauthorized'))?.statusCode).toBe(401);
    expect(mapPlacesError('forbidden')?.statusCode).toBe(403);
    expect(mapPlacesError(new Error('place_not_found'))?.statusCode).toBe(404);
    expect(mapPlacesError(new Error('places_not_configured'))?.statusCode).toBe(503);
    expect(mapPlacesError(new Error('places_upstream_error'))?.statusCode).toBe(502);
    expect(mapPlacesError('unknown')).toBeUndefined();
  });
});

describe('withPlacesErrors', () => {
  it('logs unmapped errors and uses the internal fallback', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handle = route(
      withPlacesErrors(),
      async () => {
        throw new Error('unexpected');
      },
    );
    const result = await handle({
      version: '2.0',
      rawPath: '/',
      headers: {},
      requestContext: { http: { method: 'GET', path: '/' } },
    } as APIGatewayProxyEventV2);
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body ?? '{}')).toEqual({ error: 'internal' });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
