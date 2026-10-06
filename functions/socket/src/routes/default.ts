/**
 * WebSocket `$default` route.
 */

import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyWebsocketEventV2,
} from 'aws-lambda';

/**
 * Handles WebSocket `$default`.
 *
 * The socket is delivery only; clients send messages over HTTP. This pass
 * acknowledges unexpected frames without erroring the connection.
 *
 * @param _event - The WebSocket API event.
 * @returns An empty `200`.
 */
export const handleDefault = async (
  _event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => ({ statusCode: 200 });
