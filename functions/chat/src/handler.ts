/**
 * Chat area Lambda.
 *
 * Dispatches list chats, team channels, private chats, adult search, and
 * message persistence.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handleHealth, notFound } from '../../lib/http.js';
import {
  handleCreatePrivateChat,
  handleCreateTeamChannel,
  handleListChats,
  handleListMessages,
  handleSearchUsers,
  handleSendMessage,
} from './routes/index.js';

/**
 * Normalizes a path to the chat route suffix.
 *
 * @param path - The raw request path.
 * @returns The route key without a leading slash, or an empty string for `/chat`.
 */
const routeOf = (path: string): string => {
  const normalized = path.replace(/\/+$/u, '') || '/';
  if (normalized === '/chat' || normalized === '/') return '';
  if (normalized.startsWith('/chat/')) return normalized.slice('/chat/'.length);
  if (normalized.startsWith('/')) return normalized.slice(1);
  return normalized;
};

/**
 * Handles HTTP requests for the chat area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const path = event.rawPath ?? '';
  const method = event.requestContext.http.method;

  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return handleHealth(event, 'chat');
  }

  const route = routeOf(path);
  const parts = route.length === 0 ? [] : route.split('/');

  if (method === 'GET' && parts.length === 0) return handleListChats(event);

  if (method === 'POST' && parts.length === 1 && parts[0] === 'channels') {
    return handleCreateTeamChannel(event);
  }

  if (method === 'POST' && parts.length === 1 && parts[0] === 'private') {
    return handleCreatePrivateChat(event);
  }

  if (
    method === 'GET' &&
    parts.length === 2 &&
    parts[0] === 'users' &&
    parts[1] === 'search'
  ) {
    return handleSearchUsers(event);
  }

  if (parts.length >= 1 && parts[0] !== 'channels' && parts[0] !== 'private' && parts[0] !== 'users') {
    const chatId = parts[0];
    if (parts[1] === 'messages' && parts.length === 2) {
      if (method === 'GET') return handleListMessages(event, chatId);
      if (method === 'POST') return handleSendMessage(event, chatId);
    }
  }

  return notFound();
};

