/**
 * Device route validation coverage.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../device-store.js', () => ({
  deleteDevice: async (): Promise<void> => undefined,
  putDevice: async (): Promise<never> => undefined as never,
}));

const { handleDeleteDevice } = await import('./devices.js');

describe('handleDeleteDevice', () => {
  it('rejects an empty device id', async () => {
    const result = await handleDeleteDevice(
      {
        requestContext: {
          authorizer: { jwt: { claims: { sub: 'device-route-user' } } },
        },
      } as APIGatewayProxyEventV2,
      '',
    );
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body ?? '{}')).toEqual({ error: 'invalid_body' });
  });
});
