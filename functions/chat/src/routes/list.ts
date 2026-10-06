/**
 * List chats route.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { json } from '../../../lib/http.js';import { requireUser } from '../../../lib/auth/index.js';

import { listUserChats } from '../chat-store.js';

import { withChatErrors } from './errors.js';

/**
 * Handles `GET /chat`.
 *
 * @param event - The HTTP API event.
 * @returns Chats the caller belongs to.
 */
export const handleListChats = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withChatErrors(async () => {
    const user = await requireUser(event);
    const chats = await listUserChats(user.userId);
    return json(200, { chats });
  });

