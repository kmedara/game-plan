/**
 * Billing area Lambda.
 *
 * Paid plans through Stripe Billing: checkout, the billing portal, and plan
 * status. The Stripe webhook runs as its own function (`webhook-handler.ts`).
 */

import { serveHttp } from '../../lib/pipeline.js';
import { httpRoutes } from './routes/index.js';

/**
 * Handles HTTP requests for the billing area.
 *
 * @param event - The function URL event.
 * @returns A route response, health check, or `404`.
 */
export const handler = serveHttp('billing', httpRoutes);
