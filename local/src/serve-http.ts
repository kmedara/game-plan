/**
 * Local HTTP server that invokes an area Lambda handler with Amazon API Gateway events.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { toHttpEvent, writeResult } from './lambda-http.js';

/**
 * A Lambda-shaped HTTP handler used by the local area processes.
 *
 * @param event - An Amazon API Gateway HTTP API event.
 * @returns A structured proxy result.
 */
export type HttpHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyStructuredResultV2>;

/**
 * Handles one HTTP request by adapting it for the Lambda handler.
 *
 * @param port - The listen port used when building the event URL.
 * @param handle - The area Lambda handler.
 * @param req - The incoming Node.js request.
 * @param res - The Node.js response.
 */
const onRequest = async (
  port: number,
  handle: HttpHandler,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  if (req.method === 'OPTIONS') {
    writeResult(res, { statusCode: 204 });
    return;
  }
  const event = await toHttpEvent(req, port);
  writeResult(res, await handle(event));
};

/**
 * Starts one area process. The proxy in front of it keeps a single local origin.
 *
 * @param port - The loopback port to bind.
 * @param handle - The area Lambda handler.
 */
export const serveHttp = (port: number, handle: HttpHandler): void => {
  const server = createServer((req, res) => {
    onRequest(port, handle, req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'internal' }));
    });
  });
  server.listen(port, '127.0.0.1', () => {
    console.info(`http :${port}`);
  });
};
