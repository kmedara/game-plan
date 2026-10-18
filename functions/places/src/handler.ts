/**
 * Places area Lambda.
 *
 * Proxies Google Places autocomplete, place details, and Static Maps so the
 * API key never reaches the client.
 */

import { serveHttp } from '../../lib/pipeline.js';
import { httpRoutes } from './routes/index.js';

/**
 * Handles HTTP requests for the places area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
export const handler = serveHttp('places', httpRoutes);
