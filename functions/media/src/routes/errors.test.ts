/**
 * Media error mapper coverage.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { route } from '../../../lib/pipeline.js';
import { mapMediaError, withMediaErrors } from './errors.js';

describe('mapMediaError', () => {
  it('maps string and Error values', () => {
    expect(mapMediaError(new Error('unauthorized'))?.statusCode).toBe(401);
    expect(mapMediaError('forbidden')?.statusCode).toBe(403);
    expect(mapMediaError(new Error('invalid_object_key'))?.statusCode).toBe(400);
    expect(mapMediaError(new Error('payload_too_large'))?.statusCode).toBe(400);
    expect(mapMediaError(new Error('media_bucket_not_configured'))?.statusCode).toBe(503);
    expect(mapMediaError('unknown')).toBeUndefined();
  });
});

describe('withMediaErrors', () => {
  it('logs unmapped errors and uses the internal fallback', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handle = route(
      withMediaErrors(),
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
