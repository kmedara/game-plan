/**
 * Socket connect and disconnect coverage with an in-memory table.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import { TABLE_PK, TABLE_SK } from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

vi.mock('../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(
    pk: string,
    sk: string,
  ): Promise<T | undefined> => store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
  },
  deleteItem: async (pk: string, sk: string): Promise<void> => {
    store.delete(itemKey(pk, sk));
  },
  queryBySkPrefix: async <T extends Record<string, unknown>>(
    pk: string,
    skPrefix: string,
  ): Promise<T[]> => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk.startsWith(skPrefix)) items.push(item as T);
    }
    return items;
  },
}));

vi.mock('../../lib/dynamo/client.js', () => ({
  getDocClient: () => ({
    send: async (command: { input?: { IndexName?: string; ExpressionAttributeValues?: Record<string, unknown> } }) => {
      const connectionId = command.input?.ExpressionAttributeValues?.[':connectionId'];
      if (typeof connectionId !== 'string') return { Items: [] };
      for (const item of store.values()) {
        if (item.connectionId === connectionId) {
          return { Items: [{ PK: item[TABLE_PK], SK: item[TABLE_SK] }] };
        }
      }
      return { Items: [] };
    },
  }),
  resetDocClient: () => undefined,
}));

const { handler } = await import('./handler.js');

/**
 * Builds a WebSocket event for connect or disconnect.
 *
 * @param routeKey - The route key.
 * @param connectionId - The connection id.
 * @param token - Optional access token query parameter.
 * @returns A WebSocket event.
 */
const wsEvent = (
  routeKey: '$connect' | '$disconnect' | '$default' | 'health',
  connectionId: string,
  options: {
    token?: string;
    authorizer?: unknown;
    isHttp?: boolean;
    path?: string;
  } = {},
): APIGatewayProxyWebsocketEventV2 | Record<string, unknown> => {
  if (options.isHttp) {
    return {
      version: '2.0',
      rawPath: options.path ?? '/socket/health',
      requestContext: { http: { method: 'GET', path: options.path ?? '/socket/health' } },
    };
  }
  return {
    requestContext: {
      routeKey,
      connectionId,
      ...(options.authorizer !== undefined ? { authorizer: options.authorizer } : {}),
    },
    queryStringParameters: options.token === undefined ? undefined : { token: options.token },
  } as APIGatewayProxyWebsocketEventV2;
};

describe('socket handler', () => {
  beforeEach(() => {
    store.clear();
    process.env.LOCAL_JWT_SECRET = 'socket-handler-test-secret';
  });

  afterEach(() => {
    store.clear();
  });

  it('stores a connection on connect and removes it on disconnect', async () => {
    const userId = randomUUID();
    const { accessToken } = issueLocalTokens(userId, `${userId}@example.com`);
    const connectionId = 'conn-1';

    const connect = await handler(wsEvent('$connect', connectionId, { token: accessToken }));
    expect(connect.statusCode).toBe(200);
    expect(store.has(`USER#${userId}\0CONN#${connectionId}`)).toBe(true);

    const disconnect = await handler(wsEvent('$disconnect', connectionId));
    expect(disconnect.statusCode).toBe(200);
    expect(store.has(`USER#${userId}\0CONN#${connectionId}`)).toBe(false);
  });

  it('connects from authorizer context including nested lambda claims', async () => {
    const userId = randomUUID();
    const direct = await handler(
      wsEvent('$connect', 'conn-auth', { authorizer: { sub: userId } }),
    );
    expect(direct.statusCode).toBe(200);

    const nested = await handler(
      wsEvent('$connect', 'conn-nested', {
        authorizer: { lambda: { principalId: `${userId}-nested` } },
      }),
    );
    expect(nested.statusCode).toBe(200);

    const badAuthorizer = await handler(
      wsEvent('$connect', 'conn-bad', { authorizer: 'nope' }),
    );
    expect(badAuthorizer.statusCode).toBe(401);
  });

  it('acknowledges $default and serves HTTP health / 404', async () => {
    expect((await handler(wsEvent('$default', 'c1'))).statusCode).toBe(200);
    expect((await handler(wsEvent('health', 'c1', { isHttp: true }))).statusCode).toBe(200);
    expect(
      (
        await handler(
          wsEvent('health', 'c1', { isHttp: true, path: '/socket/unknown' }),
        )
      ).statusCode,
    ).toBe(404);
  });

  it('disconnects a missing connection without error', async () => {
    expect((await handler(wsEvent('$disconnect', 'missing'))).statusCode).toBe(200);
  });

  it('returns 404 for events that are neither HTTP nor WebSocket', async () => {
    expect((await handler({ Records: [] })).statusCode).toBe(404);
  });

  it('returns 404 for unknown WebSocket routes and malformed disconnect ids', async () => {
    expect(
      (
        await handler({
          requestContext: { routeKey: 'unknown-route', connectionId: 'c1' },
        } as APIGatewayProxyWebsocketEventV2)
      ).statusCode,
    ).toBe(404);

    expect(
      (
        await handler({
          requestContext: { routeKey: '$disconnect' },
        } as APIGatewayProxyWebsocketEventV2)
      ).statusCode,
    ).toBe(200);

    const userId = randomUUID();
    const { accessToken } = issueLocalTokens(userId, `${userId}@example.com`);
    expect(
      (
        await handler({
          requestContext: { routeKey: '$connect' },
          queryStringParameters: { token: accessToken },
        } as APIGatewayProxyWebsocketEventV2)
      ).statusCode,
    ).toBe(400);
  });
});
