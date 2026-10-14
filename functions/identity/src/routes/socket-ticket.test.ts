/**
 * Branch coverage for `POST /identity/socket-ticket`.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/auth/index.js', () => ({
  verifyAuthHeader: async (authorization?: string) => {
    if (authorization === undefined || !authorization.startsWith('Bearer ')) {
      throw new Error('unauthorized');
    }
    return { userId: authorization.slice('Bearer '.length) };
  },
}));

vi.mock('../../../lib/socket-ticket.js', () => ({
  issueSocketTicket: async (userId: string) => {
    if (userId === 'explode') throw new Error('boom');
    return { ticket: `ticket-${userId}`, expiresIn: 60 };
  },
}));

const { handleSocketTicket } = await import('./socket-ticket.js');

const event = (authorization?: string): APIGatewayProxyEventV2 =>
  ({
    headers: authorization === undefined ? {} : { authorization },
    requestContext: { http: { method: 'POST' } },
  }) as APIGatewayProxyEventV2;

describe('handleSocketTicket', () => {
  it('maps an unexpected issue failure to 401', async () => {
    const result = await handleSocketTicket(event('Bearer explode'));
    expect(result.statusCode).toBe(401);
  });
});
