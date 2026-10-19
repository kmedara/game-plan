/**
 * Payments route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleCreateAccountLink, handleGetAccount } from './account.js';
import { handleCreateCharge, handleGetCharge, handleListCharges, handleUpdateDue } from './charges.js';
import { handleCreateCheckout, handleListMyDues, handlePaymentReturn } from './checkout.js';
import { handleStripeWebhook } from './webhook.js';

export {
  handleCreateAccountLink,
  handleCreateCharge,
  handleCreateCheckout,
  handleGetAccount,
  handleGetCharge,
  handleListCharges,
  handleListMyDues,
  handlePaymentReturn,
  handleStripeWebhook,
  handleUpdateDue,
};

/** Every payments HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handleGetAccount,
  handleCreateAccountLink,
  handleListCharges,
  handleCreateCharge,
  handleGetCharge,
  handleUpdateDue,
  handleCreateCheckout,
  handleListMyDues,
  handlePaymentReturn,
  handleStripeWebhook,
];
