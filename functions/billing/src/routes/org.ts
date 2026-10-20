/**
 * An organization's subscription: checkout and the billing portal. Only the
 * organization's owner manages billing.
 */

import { effectivePlanTier } from '@gameplan/rules';
import { billingPortalBodySchema, orgCheckoutBodySchema } from '@gameplan/schemas';
import { getItem, orgMetaSk, orgPk } from '../../../lib/dynamo/index.js';
import { requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { extraTeamsFor } from '../../../lib/org-seats.js';
import { memberTeamIds, orgPlan } from '../../../lib/orgs.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { getOrgBilling } from '../billing-store.js';
import { billingGateway, ORG_EXTRA_TEAM_LOOKUP_KEYS, ORG_LOOKUP_KEYS } from '../gateway.js';
import { billingReturnUrl } from '../return-urls.js';
import { withBillingErrors } from './errors.js';

/**
 * Requires the caller to own the organization.
 *
 * @param orgId - The organization.
 * @param userId - The caller.
 * @throws `org_not_found` or `forbidden`.
 */
const requireOrgOwner = async (orgId: string, userId: string): Promise<void> => {
  const org = await getItem<{ ownerId?: string }>(orgPk(orgId), orgMetaSk());
  if (org === undefined) throw new Error('org_not_found');
  if (org.ownerId !== userId) throw new Error('forbidden');
};

/**
 * `POST /billing/orgs/:orgId/checkout`
 *
 * Opens Stripe Checkout for the organization plan, monthly or yearly, with
 * one extra-team item for each team past the included ones.
 */
export const handleOrgCheckout = route(
  'POST',
  '/billing/orgs/:orgId/checkout',
  withBillingErrors(),
  requireUser(),
  withBodyValidation(orgCheckoutBodySchema),
  async ({ orgId, user, body }) => {
    await requireOrgOwner(orgId, user.userId);
    const [plan, billing, teams] = await Promise.all([orgPlan(orgId), getOrgBilling(orgId), memberTeamIds(orgId)]);
    if (effectivePlanTier(plan) !== 'free') throw new Error('already_subscribed');
    const gateway = billingGateway();
    const extra = extraTeamsFor(teams.length);
    const session = await gateway.createCheckoutSession({
      priceId: await gateway.priceId(ORG_LOOKUP_KEYS[body.interval]),
      ...(extra > 0
        ? { extraItems: [{ priceId: await gateway.priceId(ORG_EXTRA_TEAM_LOOKUP_KEYS[body.interval]), quantity: extra }] }
        : {}),
      ...(billing !== undefined ? { customerId: billing.customerId } : {}),
      ...(user.email !== undefined ? { email: user.email } : {}),
      metadata: { orgId, scope: 'organization', purchasedBy: user.userId },
      successUrl: billingReturnUrl({ to: body.returnTo, result: 'subscribed', orgId }),
      cancelUrl: billingReturnUrl({ to: body.returnTo, result: 'cancel', orgId }),
    });
    return json(200, { url: session.url });
  },
);

/** `POST /billing/orgs/:orgId/portal` — plan changes, cards, cancellation, and invoices. */
export const handleOrgPortal = route(
  'POST',
  '/billing/orgs/:orgId/portal',
  withBillingErrors(),
  requireUser(),
  withBodyValidation(billingPortalBodySchema),
  async ({ orgId, user, body }) => {
    await requireOrgOwner(orgId, user.userId);
    const billing = await getOrgBilling(orgId);
    if (billing === undefined) throw new Error('no_billing_account');
    const session = await billingGateway().createPortalSession(
      billing.customerId,
      billingReturnUrl({ to: body.returnTo, result: 'portal', orgId }),
    );
    return json(200, { url: session.url });
  },
);
