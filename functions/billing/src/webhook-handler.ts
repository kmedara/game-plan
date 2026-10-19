/**
 * Stripe Billing webhook Lambda.
 *
 * Stripe cannot sign requests for CloudFront's origin access control, so the
 * webhook has its own public function URL. This entry serves only that one
 * route; every other billing route stays behind the IAM-only URL.
 */

import { serveHttp } from '../../lib/pipeline.js';
import { handleBillingWebhook } from './routes/webhook.js';

/**
 * Handles `POST /billing/webhook` and health checks; anything else is `404`.
 *
 * @param event - The function URL event.
 * @returns The webhook response.
 */
export const handler = serveHttp('billing', [handleBillingWebhook]);
