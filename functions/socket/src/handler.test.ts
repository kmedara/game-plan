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
  routeKey: '$connect' | '$disconnect',
  connectionId: string,
  token?: string,
): APIGatewayProxyWebsocketEventV2 =>
  ({
    requestContext: { routeKey, connectionId },
    queryStringParameters: token === undefined ? undefined : { token },
  }) as APIGatewayProxyWebsocketEventV2;

describe('socket handler', () => {
  beforeEach(() => {
    store.clear();
  });

  afterEach(() => {
    store.clear();
  });

  it('stores a connection on connect and removes it on disconnect', async () => {
    const userId = randomUUID();
    const { accessToken } = issueLocalTokens(userId, `${userId}@example.com`);
    const connectionId = 'conn-1';

    const connect = await handler(wsEvent('$connect', connectionId, accessToken));
    expect(connect.statusCode).toBe(200);
    expect(store.has(`USER#${userId}\0CONN#${connectionId}`)).toBe(true);

    const disconnect = await handler(wsEvent('$disconnect', connectionId));
    expect(disconnect.statusCode).toBe(200);
    expect(store.has(`USER#${userId}\0CONN#${connectionId}`)).toBe(false);
  });
});
