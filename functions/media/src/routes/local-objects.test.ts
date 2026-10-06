/**
 * Local object routes when not in local media mode.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../media-store.js', () => ({
  isLocalMedia: () => false,
  putLocalObject: vi.fn(),
  getLocalObject: vi.fn(),
}));

const { handleLocalGetObject, handleLocalPutObject } = await import('./local-objects.js');

const event = (
  method: string,
  body?: string,
  headers: Record<string, string> = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: '/',
    headers,
    body,
    requestContext: { http: { method, path: '/' } },
  }) as APIGatewayProxyEventV2;

describe('local-objects routes', () => {
  beforeEach(() => {
    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.MEDIA_LOCAL;
  });

  afterEach(() => {
    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.MEDIA_LOCAL;
  });

  it('returns not found outside local media mode', async () => {
    expect((await handleLocalGetObject(event('GET'), 'uploads/u/x')).statusCode).toBe(404);
    expect((await handleLocalPutObject(event('PUT', 'bytes'), 'uploads/u/x')).statusCode).toBe(
      404,
    );
  });
});
