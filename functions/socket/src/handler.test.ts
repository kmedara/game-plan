/**
 * Socket connect and disconnect coverage with an in-memory table.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_PK, TABLE_SK, ticketPk, ticketSk } from '../../lib/dynamo/keys.js';

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
    send: async (command: {
      input?: {
        Key?: { PK?: string; SK?: string };
        ExpressionAttributeValues?: Record<string, unknown>;
      };
    }) => {
      const key = command.input?.Key;
      if (key?.PK !== undefined && key.SK !== undefined) {
        const existing = store.get(itemKey(key.PK, key.SK));
        if (existing === undefined) {
          const error = new Error('ConditionalCheckFailed');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        store.delete(itemKey(key.PK, key.SK));
        return { Attributes: existing };
      }
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
 * @param ticket - Optional connect-ticket query parameter.
 * @returns A WebSocket event.
 */
const wsEvent = (
  routeKey: '$connect' | '$disconnect' | '$default' | 'health',
  connectionId: string,
  options: {
    ticket?: string;
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
    queryStringParameters: options.ticket === undefined ? undefined : { ticket: options.ticket },
  } as APIGatewayProxyWebsocketEventV2;
};

describe('socket handler', () => {
  beforeEach(() => {
    store.clear();
  });

  /**
   * Stores a connect ticket the local `$connect` path can redeem.
   *
   * @param userId - The user the ticket should authorize.
   * @param ticket - The opaque ticket id.
   */
  const seedTicket = (userId: string, ticket: string): void => {
    store.set(itemKey(ticketPk(ticket), ticketSk()), {
      [TABLE_PK]: ticketPk(ticket),
      [TABLE_SK]: ticketSk(),
      userId,
      ttl: Math.floor(Date.now() / 1000) + 60,
    });
  };

  afterEach(() => {
    store.clear();
  });

  it('rejects a connect with a missing, empty, or unknown ticket', async () => {
    expect((await handler(wsEvent('$connect', 'conn-none'))).statusCode).toBe(401);
    expect((await handler(wsEvent('$connect', 'conn-empty', { ticket: '' }))).statusCode).toBe(401);
    expect((await handler(wsEvent('$connect', 'conn-unknown', { ticket: 'missing' }))).statusCode).toBe(
      401,
    );
  });

  it('stores a connection on connect and removes it on disconnect', async () => {
    const userId = randomUUID();
    const connectionId = 'conn-1';
    seedTicket(userId, 'ticket-1');

    const connect = await handler(wsEvent('$connect', connectionId, { ticket: 'ticket-1' }));
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
    seedTicket(userId, 'ticket-open');
    expect(
      (
        await handler({
          requestContext: { routeKey: '$connect' },
          queryStringParameters: { ticket: 'ticket-open' },
        } as APIGatewayProxyWebsocketEventV2)
      ).statusCode,
    ).toBe(400);
  });
});
