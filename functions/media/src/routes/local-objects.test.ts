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
  rawPath = '/media/local-objects/uploads/u/x',
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath,
    headers,
    body,
    requestContext: { http: { method, path: rawPath } },
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
    expect((await handleLocalGetObject(event('GET'))).statusCode).toBe(404);
    expect((await handleLocalPutObject(event('PUT', 'bytes'))).statusCode).toBe(
      404,
    );
  });
});
