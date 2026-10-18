/**
 * Chat area Lambda.
 *
 * Dispatches list chats, team channels, private chats, adult search, and
 * message persistence.
 */

import { serveHttp } from '../../lib/pipeline.js';
import { httpRoutes } from './routes/index.js';

/**
 * Handles HTTP requests for the chat area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
export const handler = serveHttp('chat', httpRoutes);
