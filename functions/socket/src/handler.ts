/**
 * Socket area Lambda for WebSocket `$connect`, `$disconnect`, and `$default`.
 *
 * Dispatches each WebSocket route to its own module. HTTP is health only.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handleHealth, isHttpEvent, isWebSocketEvent, notFound } from '../../lib/http.js';
import { handleConnect, handleDefault, handleDisconnect } from './routes/index.js';

/**
 * Handles HTTP health plus the WebSocket routes.
 *
 * @param event - An HTTP or WebSocket Amazon API Gateway event.
 * @returns A health response, a WebSocket route response, or `404`.
 */
export const handler = async (event: unknown): Promise<APIGatewayProxyStructuredResultV2> => {
  if (isHttpEvent(event)) return handleHealth(event, 'socket');
  if (!isWebSocketEvent(event)) return notFound();

  switch (event.requestContext.routeKey) {
    case '$connect':
      return handleConnect(event);
    case '$disconnect':
      return handleDisconnect(event);
    case '$default':
      return handleDefault(event);
    default:
      return notFound();
  }
};
