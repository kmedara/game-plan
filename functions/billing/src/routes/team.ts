/**
 * A team's subscription: status, checkout, and the billing portal.
 */

import { effectivePlanTier } from '@gameplan/rules';
import { billingPortalBodySchema, billingReturnQuerySchema, teamCheckoutBodySchema } from '@gameplan/schemas';
import { loadTeamPlan } from '../../../lib/entitlements.js';
import { requireMembership, requirePermission, requireUser } from '../../../lib/guards.js';
import { json, redirect } from '../../../lib/http.js';
import { route, withBodyValidation, withQueryValidation } from '../../../lib/pipeline.js';
import { getTeamBilling } from '../billing-store.js';
import { billingGateway, PREMIUM_LOOKUP_KEYS } from '../gateway.js';
import { billingLandingUrl, billingReturnUrl } from '../return-urls.js';
import { withBillingErrors } from './errors.js';

/** `GET /billing/teams/:teamId` — any member may see the team's plan. */
export const handleGetTeamBilling = route(
  'GET',
  '/billing/teams/:teamId',
  withBillingErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId }) => {
    const [plan, billing] = await Promise.all([loadTeamPlan(teamId), getTeamBilling(teamId)]);
    return json(200, { teamId, plan, hasBillingAccount: billing !== undefined });
  },
);

/**
 * `POST /billing/teams/:teamId/checkout`
 *
 * Opens Stripe Checkout for the premium plan, monthly or yearly. A team that
 * already pays, or whose plan comes from an organization, changes its plan in
 * the billing portal or the organization instead.
 */
export const handleTeamCheckout = route(
  'POST',
  '/billing/teams/:teamId/checkout',
  withBillingErrors(),
  requireUser(),
  withBodyValidation(teamCheckoutBodySchema),
  requireMembership(),
  requirePermission('manage_billing'),
  async ({ teamId, user, body }) => {
    const [plan, billing] = await Promise.all([loadTeamPlan(teamId), getTeamBilling(teamId)]);
    if (plan.orgId !== undefined) throw new Error('managed_by_organization');
    if (effectivePlanTier(plan) !== 'free') throw new Error('already_subscribed');
    const gateway = billingGateway();
    const session = await gateway.createCheckoutSession({
      priceId: await gateway.priceId(PREMIUM_LOOKUP_KEYS[body.interval]),
      ...(billing !== undefined ? { customerId: billing.customerId } : {}),
      ...(user.email !== undefined ? { email: user.email } : {}),
      metadata: { teamId, scope: 'team', purchasedBy: user.userId },
      successUrl: billingReturnUrl({ to: body.returnTo, result: 'subscribed', teamId }),
      cancelUrl: billingReturnUrl({ to: body.returnTo, result: 'cancel', teamId }),
    });
    return json(200, { url: session.url });
  },
);

/**
 * `POST /billing/teams/:teamId/portal`
 *
 * Opens the Stripe billing portal to switch monthly and yearly, update the
 * card, cancel, or download invoices.
 */
export const handleTeamPortal = route(
  'POST',
  '/billing/teams/:teamId/portal',
  withBillingErrors(),
  requireUser(),
  withBodyValidation(billingPortalBodySchema),
  requireMembership(),
  requirePermission('manage_billing'),
  async ({ teamId, body }) => {
    const billing = await getTeamBilling(teamId);
    if (billing === undefined) throw new Error('no_billing_account');
    const session = await billingGateway().createPortalSession(
      billing.customerId,
      billingReturnUrl({ to: body.returnTo, result: 'portal', teamId }),
    );
    return json(200, { url: session.url });
  },
);

/**
 * `GET /billing/return`
 *
 * The fixed URL handed to Stripe. Sends the browser on to the app deep link or
 * the team's page on the website. Needs no sign-in.
 */
export const handleBillingReturn = route(
  'GET',
  '/billing/return',
  withBillingErrors(),
  withQueryValidation(billingReturnQuerySchema),
  async ({ query }) => redirect(billingLandingUrl(query)),
);
