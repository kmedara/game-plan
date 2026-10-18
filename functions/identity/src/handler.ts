/**
 * Identity area Lambda.
 *
 * Dispatches register, email confirmation, login, refresh, logout, OAuth, profile complete, socket tickets, and `GET /me`.
 */

import { serveHttp } from '../../lib/pipeline.js';
import { httpRoutes } from './routes/index.js';

/**
 * Handles HTTP requests for the identity area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
export const handler = serveHttp('identity', httpRoutes);
