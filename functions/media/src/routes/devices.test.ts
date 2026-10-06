/**
 * Device route validation coverage.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../device-store.js', () => ({
  deleteDevice: async (): Promise<void> => undefined,
  putDevice: async (): Promise<never> => undefined as never,
}));

const { handleDeleteDevice } = await import('./devices.js');

describe('handleDeleteDevice', () => {
  beforeEach(() => {
    process.env.AUTH_DISABLED = 'true';
    process.env.AUTH_SEED_USER_ID = 'device-route-user';
  });

  afterEach(() => {
    delete process.env.AUTH_DISABLED;
    delete process.env.AUTH_SEED_USER_ID;
  });

  it('rejects an empty device id', async () => {
    const result = await handleDeleteDevice({} as APIGatewayProxyEventV2, '');
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body ?? '{}')).toEqual({ error: 'invalid_body' });
  });
});
