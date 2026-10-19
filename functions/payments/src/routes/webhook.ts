/**
 * The Stripe webhook. Stripe signs the body; there is no bearer token.
 */

import { headerOf, json } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';
import { paymentGateway } from '../stripe.js';
import { applyStripeEvent } from '../webhook.js';
import { withPaymentsErrors } from './errors.js';

/**
 * `POST /payments/webhook`
 *
 * Verifies the `Stripe-Signature` header against the exact bytes received,
 * then applies the event. A `4xx` or `5xx` makes Stripe retry later.
 */
export const handleStripeWebhook = route(
  'POST',
  '/payments/webhook',
  withPaymentsErrors(),
  async ({ event }) => {
    const signature = headerOf(event, 'stripe-signature');
    if (signature === undefined) throw new Error('invalid_signature');
    const raw =
      event.body === undefined
        ? ''
        : event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString('utf8')
          : event.body;
    await applyStripeEvent(await paymentGateway().verifyWebhook(raw, signature));
    return json(200, { received: true });
  },
);
