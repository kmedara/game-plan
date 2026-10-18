/**
 * Teams area Lambda.
 *
 * Dispatches create team, team settings, roster, invites, join requests, roles,
 * and the permission matrix.
 */

import { serveHttp } from '../../lib/pipeline.js';
import { httpRoutes } from './routes/index.js';

/**
 * Handles HTTP requests for the teams area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
export const handler = serveHttp('teams', httpRoutes);
