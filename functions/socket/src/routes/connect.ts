/**
 * WebSocket `$connect` route.
 */

import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';
import { putConnection } from '../connection-store.js';
import { resolveConnectUserId } from '../resolve-user.js';

/**
 * Handles WebSocket `$connect`.
 *
 * Stores the connection under the user partition so fan-out can post while the
 * app is open. A time-to-live clears rows left by a dropped phone.
 *
 * @param event - The WebSocket API event.
 * @returns An empty `200`, or `401` when the caller is not authenticated.
 */
export const handleConnect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const userId = await resolveConnectUserId(event);
    const connectionId = event.requestContext.connectionId;
    if (connectionId === undefined || connectionId.length === 0) {
      return { statusCode: 400 };
    }
    await putConnection(userId, connectionId);
    return { statusCode: 200 };
  } catch {
    return { statusCode: 401 };
  }
};
