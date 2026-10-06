/**
 * Local WebSocket delivery used when fan-out posts to open browsers.
 */

import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serveSocket } from './serve-socket.js';

/** Connection ids captured from local `$connect` events. */
const connectionIds: string[] = [];

/** Open browser stand-ins for the current test. */
const clients: WebSocket[] = [];

/** Server under test, closed after each case. */
let server: Server | undefined;

/**
 * Accepts every connect so the socket is registered for delivery.
 *
 * @param event - A WebSocket lifecycle event from the local server.
 * @returns An empty success result.
 */
const acceptConnect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  if (event.requestContext.routeKey === '$connect') {
    const connectionId = event.requestContext.connectionId;
    if (connectionId !== undefined) connectionIds.push(connectionId);
  }
  return { statusCode: 200 };
};

describe('serveSocket', () => {
  afterEach(async () => {
    for (const client of clients) client.close();
    clients.length = 0;
    connectionIds.length = 0;
    const current = server;
    server = undefined;
    if (current === undefined) return;
    current.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      current.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('sends a text frame to every open socket, including one that did not post', async () => {
    server = serveSocket(0, acceptConnect as unknown as Parameters<typeof serveSocket>[1]);
    if (!server.listening) await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;

    const open = async (): Promise<WebSocket> => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/socket?token=local`);
      clients.push(ws);
      await once(ws, 'open');
      return ws;
    };

    const [first, second] = await Promise.all([open(), open()]);
    await vi.waitFor(() => {
      expect(connectionIds).toHaveLength(2);
    });

    const payload = JSON.stringify({
      type: 'chat_message',
      chatId: 'c1',
      messageId: 'm1',
      senderId: 'u1',
      body: 'hello from the other browser',
      createdAt: '2026-10-05T00:00:00.000Z',
    });

    const received = [first, second].map(
      (ws) =>
        new Promise<{ text: string; binary: boolean }>((resolve) => {
          ws.once('message', (data, isBinary) => {
            const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
            resolve({ text, binary: isBinary });
          });
        }),
    );

    for (const connectionId of connectionIds) {
      let status = 0;
      for (let attempt = 0; attempt < 20 && status !== 200; attempt += 1) {
        const response = await fetch(
          `http://127.0.0.1:${port}/@connections/${connectionId}`,
          { method: 'POST', body: payload },
        );
        status = response.status;
        if (status !== 200) await new Promise((resolve) => setTimeout(resolve, 15));
      }
      expect(status).toBe(200);
    }

    await expect(Promise.all(received)).resolves.toEqual([
      { text: payload, binary: false },
      { text: payload, binary: false },
    ]);
  });
});
