/**
 * Organizations area Lambda.
 *
 * One club or league over many teams: admins, teams, announcements.
 */

import { serveHttp } from '../../lib/pipeline.js';
import { httpRoutes } from './routes/index.js';

/**
 * Handles HTTP requests for the organizations area.
 *
 * @param event - The function URL event.
 * @returns A route response, health check, or `404`.
 */
export const handler = serveHttp('orgs', httpRoutes);
