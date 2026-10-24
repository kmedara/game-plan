/**
 * The Stripe webhook. Stripe signs the body; there is no bearer token.
 */

import { stripeWebhookRoute } from '../../../lib/stripe-webhook.js';
import { paymentGateway } from '../stripe.js';
import { applyStripeEvent } from '../webhook.js';
import { withPaymentsErrors } from './errors.js';

/** `POST /payments/webhook` */
export const handleStripeWebhook = stripeWebhookRoute('/payments/webhook', {
  errors: withPaymentsErrors(),
  verify: (raw, signature) => paymentGateway().verifyWebhook(raw, signature),
  apply: applyStripeEvent,
});
