/**
 * Local HTTP and WebSocket server for the socket area.
 *
 * HTTP covers the health check and the management-API shaped
 * `POST /@connections/{id}` path so fan-out can deliver without the cloud.
 * The WebSocket path mirrors `$connect`, `$disconnect`, and `$default`.
 */

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';
import { WebSocket, WebSocketServer } from 'ws';
import { toHttpEvent, writeResult } from './lambda-http.js';
import type { HttpHandler } from './serve-http.js';

/**
 * A handler that accepts both HTTP health checks and WebSocket lifecycle events.
 */
type SocketHandler = HttpHandler &
  ((event: APIGatewayProxyWebsocketEventV2) => Promise<APIGatewayProxyStructuredResultV2>);

/** Live local sockets keyed by the synthetic connection id. */
const liveSockets = new Map<string, WebSocket>();

/**
 * Builds a WebSocket API event for a local connection lifecycle step.
 *
 * @param routeKey - The Amazon API Gateway WebSocket route key.
 * @param connectionId - The synthetic connection id for this local socket.
 * @param req - The upgrade request, used for query-string parameters.
 * @returns A WebSocket event shaped like Amazon API Gateway.
 */
const wsEvent = (
  routeKey: '$connect' | '$disconnect' | '$default',
  connectionId: string,
  req: IncomingMessage,
): APIGatewayProxyWebsocketEventV2 =>
  ({
    requestContext: {
      routeKey,
      connectionId,
      eventType:
        routeKey === '$connect'
          ? 'CONNECT'
          : routeKey === '$disconnect'
            ? 'DISCONNECT'
            : 'MESSAGE',
      domainName: 'localhost',
      stage: 'local',
      apiId: 'local',
    },
    queryStringParameters: Object.fromEntries(
      new URL(req.url ?? '/', 'http://127.0.0.1').searchParams,
    ),
    isBase64Encoded: false,
  }) as APIGatewayProxyWebsocketEventV2;

/**
 * Handles `POST /@connections/{connectionId}` the way the management API does.
 *
 * @param req - The incoming HTTP request.
 * @param res - The HTTP response.
 * @param connectionId - The target connection id.
 */
const handlePostToConnection = (
  req: IncomingMessage,
  res: ServerResponse,
  connectionId: string,
): void => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });
  req.on('end', () => {
    const socket = liveSockets.get(connectionId);
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      res.writeHead(410, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Gone' }));
      return;
    }
    const data = Buffer.concat(chunks);
    try {
      socket.send(data);
      res.writeHead(200);
      res.end();
    } catch {
      res.writeHead(410, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Gone' }));
    }
  });
};

/**
 * Serves HTTP health on the same port as a local WebSocket the proxy can upgrade to.
 *
 * @param port - The loopback port to bind.
 * @param handle - The socket area handler.
 */
export const serveSocket = (port: number, handle: SocketHandler): void => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const connectionMatch = url.pathname.match(/^\/@connections\/([^/]+)$/u);
    if (req.method === 'POST' && connectionMatch?.[1] !== undefined) {
      handlePostToConnection(req, res, decodeURIComponent(connectionMatch[1]));
      return;
    }

    toHttpEvent(req, port)
      .then((event) => handle(event))
      .then((result) => writeResult(res, result))
      .catch((error: unknown) => {
        console.error(error);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal' }));
      });
  });

  const sockets = new WebSocketServer({ server });
  sockets.on('connection', (ws, req) => {
    const connectionId = randomUUID();
    void (async () => {
      const result = await handle(wsEvent('$connect', connectionId, req));
      if (result.statusCode !== undefined && result.statusCode >= 400) {
        ws.close();
        return;
      }
      liveSockets.set(connectionId, ws);
    })();

    ws.on('message', () => {
      void handle(wsEvent('$default', connectionId, req));
    });
    ws.on('close', () => {
      liveSockets.delete(connectionId);
      void handle(wsEvent('$disconnect', connectionId, req));
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.info(`socket :${port}`);
  });
};
