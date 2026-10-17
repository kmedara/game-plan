/**
 * Unit tests for the WebSocket `$connect` ticket authorizer.
 */

import type { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { used } = vi.hoisted(() => ({ used: new Set<string>() }));

vi.mock('../../lib/socket-ticket.js', () => ({
  redeemSocketTicket: async (ticket: string) => {
    if (ticket === 'fresh') return 'user-1';
    if (ticket === 'boom') throw new Error('dynamo down');
    if (ticket === 'odd') throw 'odd';
    if (ticket !== 'once' || used.has(ticket)) return undefined;
    used.add(ticket);
    return 'user-1';
  },
}));

const { handler } = await import('./authorize.js');

const SECRET = 'origin-secret';

/**
 * Builds a REQUEST authorizer event with an optional ticket query parameter.
 *
 * @param ticket - The `ticket` query value, or omit to leave the map empty.
 * @param headers - Request headers. Defaults to the CloudFront origin header.
 * @returns An Amazon API Gateway REQUEST authorizer event.
 */
const event = (
  ticket?: string,
  headers: Record<string, string> = { 'X-Origin-Verify': SECRET },
): APIGatewayRequestAuthorizerEvent =>
  ({
    type: 'REQUEST',
    methodArn: 'arn:aws:execute-api:us-east-1:000000000000:api/prod/$connect',
    queryStringParameters: ticket === undefined ? null : { ticket },
    headers,
  }) as APIGatewayRequestAuthorizerEvent;

describe('socket authorizer', () => {
  beforeEach(() => {
    used.clear();
    process.env.ORIGIN_VERIFY_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.ORIGIN_VERIFY_SECRET;
  });

  it('rejects a connect that has no ticket', async () => {
    await expect(handler(event())).rejects.toThrow('Unauthorized');
    await expect(handler(event(''))).rejects.toThrow('Unauthorized');
  });

  it('rejects a ticket that was already used', async () => {
    await expect(handler(event('once'))).resolves.toMatchObject({ principalId: 'user-1' });
    await expect(handler(event('once'))).rejects.toThrow('Unauthorized');
  });

  it('allows a fresh ticket', async () => {
    const result = await handler(event('fresh'));
    expect(result.principalId).toBe('user-1');
    expect(result.context).toEqual({ sub: 'user-1' });
    expect(result.policyDocument.Statement[0]?.Effect).toBe('Allow');
  });

  it('hides redeem failures as unauthorized', async () => {
    await expect(handler(event('boom'))).rejects.toThrow('Unauthorized');
    await expect(handler(event('odd'))).rejects.toThrow('Unauthorized');
  });

  it('rejects a connect that skipped CloudFront without spending the ticket', async () => {
    await expect(handler(event('once', {}))).rejects.toThrow('Unauthorized');
    await expect(handler(event('once', { 'x-origin-verify': 'guess-123456' }))).rejects.toThrow(
      'Unauthorized',
    );
    await expect(handler(event('once'))).resolves.toMatchObject({ principalId: 'user-1' });
  });

  it('rejects every connect when the origin secret is not configured', async () => {
    delete process.env.ORIGIN_VERIFY_SECRET;
    await expect(handler(event('fresh'))).rejects.toThrow('Unauthorized');
  });
});
