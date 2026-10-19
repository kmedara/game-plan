/**
 * Billing route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleBillingReturn, handleGetTeamBilling, handleTeamCheckout, handleTeamPortal } from './team.js';
import { handleBillingWebhook } from './webhook.js';

export { handleBillingReturn, handleBillingWebhook, handleGetTeamBilling, handleTeamCheckout, handleTeamPortal };

/** Every billing HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handleGetTeamBilling,
  handleTeamCheckout,
  handleTeamPortal,
  handleBillingReturn,
  handleBillingWebhook,
];
