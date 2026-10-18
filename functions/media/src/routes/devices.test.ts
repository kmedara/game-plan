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
const { issueLocalTokens } = await import('../../../lib/auth/index.js');

describe('handleDeleteDevice', () => {
  it('rejects an oversized device id', async () => {
    process.env.LOCAL_JWT_SECRET = 'devices-test-secret';
    const { accessToken } = issueLocalTokens('device-route-user', 'device@example.com');
    const deviceId = 'd'.repeat(129);
    const result = await handleDeleteDevice({
      rawPath: `/media/devices/${deviceId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      requestContext: { http: { method: 'DELETE', path: `/media/devices/${deviceId}` } },
    } as unknown as APIGatewayProxyEventV2);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body ?? '{}')).toEqual({ error: 'invalid_body' });
  });
});
