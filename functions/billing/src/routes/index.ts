/**
 * Billing route handlers.
 */

import type { HttpRoute } from '../../../lib/pipeline.js';
import { handleOrgCheckout, handleOrgPortal } from './org.js';
import { handleBillingReturn, handleGetTeamBilling, handleTeamCheckout, handleTeamPortal } from './team.js';
import { handleBillingWebhook } from './webhook.js';

export {
  handleBillingReturn,
  handleBillingWebhook,
  handleGetTeamBilling,
  handleOrgCheckout,
  handleOrgPortal,
  handleTeamCheckout,
  handleTeamPortal,
};

/** Every billing HTTP route, matched by method and path. */
export const httpRoutes: readonly HttpRoute[] = [
  handleGetTeamBilling,
  handleTeamCheckout,
  handleTeamPortal,
  handleOrgCheckout,
  handleOrgPortal,
  handleBillingReturn,
  handleBillingWebhook,
];
