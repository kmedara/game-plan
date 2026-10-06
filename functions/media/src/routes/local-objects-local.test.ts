/**
 * Local object routes in local media mode (body and content-type branches).
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

const putLocalObject = vi.fn();

vi.mock('../media-store.js', () => ({
  isLocalMedia: () => true,
  putLocalObject: (...args: unknown[]) => putLocalObject(...args),
  getLocalObject: () => undefined,
}));

const { handleLocalPutObject } = await import('./local-objects.js');

describe('local-objects put in local mode', () => {
  it('uses an empty body and default content type when omitted', async () => {
    putLocalObject.mockClear();
    const result = await handleLocalPutObject(
      {
        version: '2.0',
        rawPath: '/',
        headers: {},
        requestContext: { http: { method: 'PUT', path: '/' } },
      } as APIGatewayProxyEventV2,
      'uploads/u/file.bin',
    );
    expect(result.statusCode).toBe(204);
    expect(putLocalObject).toHaveBeenCalledWith(
      'uploads/u/file.bin',
      'application/octet-stream',
      Buffer.from('', 'binary'),
    );
  });
});
