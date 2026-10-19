/**
 * The Stripe Billing webhook. Stripe signs the body; there is no bearer token.
 */

import { headerOf, json } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import { billingGateway } from '../gateway.js';
import { applyBillingEvent } from '../webhook.js';
import { withBillingErrors } from './errors.js';

/**
 * `POST /billing/webhook`
 *
 * Verifies the `Stripe-Signature` header against the exact bytes received,
 * then applies the event. A `4xx` or `5xx` makes Stripe retry later.
 */
export const handleBillingWebhook = route(
  'POST',
  '/billing/webhook',
  withBillingErrors(),
  async ({ event }) => {
    const signature = headerOf(event, 'stripe-signature');
    if (signature === undefined) throw new Error('invalid_signature');
    const raw =
      event.body === undefined
        ? ''
        : event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body;
    await applyBillingEvent(await billingGateway().verifyWebhook(raw, signature));
    return json(200, { received: true });
  },
);
