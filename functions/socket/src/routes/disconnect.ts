/**
 * WebSocket `$disconnect` route.
 */

import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';
import { deleteConnection, findConnectionById } from '../connection-store.js';

/**
 * Handles WebSocket `$disconnect`.
 *
 * Looks up the user via the connection-id Global Secondary Index (GSI), then
 * deletes the connection row. Missing rows are ignored so a double disconnect
 * stays idempotent.
 *
 * @param event - The WebSocket API event.
 * @returns An empty `200`.
 */
export const handleDisconnect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const connectionId = event.requestContext.connectionId;
  if (connectionId === undefined || connectionId.length === 0) {
    return { statusCode: 200 };
  }

  const existing = await findConnectionById(connectionId);
  if (existing !== undefined) {
    await deleteConnection(existing.userId, connectionId);
  }
  return { statusCode: 200 };
};
