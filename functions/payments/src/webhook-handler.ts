/**
 * Stripe webhook Lambda.
 *
 * Stripe cannot sign requests for CloudFront's origin access control, so the
 * webhook has its own public function URL. This entry serves only that one
 * route; every other payments route stays behind the IAM-only URL.
 */

import { serveHttp } from '../../lib/pipeline.js';
import { handleStripeWebhook } from './routes/webhook.js';

/**
 * Handles `POST /payments/webhook` and health checks; anything else is `404`.
 *
 * @param event - The function URL event.
 * @returns The webhook response.
 */
export const handler = serveHttp('payments', [handleStripeWebhook]);
