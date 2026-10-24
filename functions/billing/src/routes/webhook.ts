/**
 * The Stripe Billing webhook. Stripe signs the body; there is no bearer token.
 */

import { stripeWebhookRoute } from '../../../lib/stripe-webhook.js';
import { billingGateway } from '../gateway.js';
import { applyBillingEvent } from '../webhook.js';
import { withBillingErrors } from './errors.js';

/** `POST /billing/webhook` */
export const handleBillingWebhook = stripeWebhookRoute('/billing/webhook', {
  errors: withBillingErrors(),
  verify: (raw, signature) => billingGateway().verifyWebhook(raw, signature),
  apply: applyBillingEvent,
});
