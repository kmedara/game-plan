/**
 * Media area Lambda.
 *
 * Presigned Amazon Simple Storage Service (S3) upload and download, device
 * token registration for offline push, and a local object store for laptop work.
 */

import { serveHttp } from '../../lib/pipeline.js';
import { httpRoutes } from './routes/index.js';

/**
 * Handles HTTP requests for the media area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
export const handler = serveHttp('media', httpRoutes);
