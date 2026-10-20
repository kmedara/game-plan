/**
 * Applies verified Stripe Billing events to team and organization plans.
 *
 * A subscription is an organization's when its metadata (or its customer)
 * names one; otherwise it is a team's.
 *
 * The subscription events carry everything the plan row needs, so they are the
 * source of truth; checkout completion only records the customer. Every
 * handler is safe to run twice.
 */

import type { BillingInterval, PlanStatus, PlanTier } from '@gameplan/types';
import type { VerifiedStripeEvent } from '../../lib/stripe-client.js';
import { syncOrgSeats } from '../../lib/org-seats.js';
import {
  applyOrgSubscription,
  applySubscription,
  orgIdForCustomer,
  saveOrgBilling,
  saveTeamBilling,
  teamIdForCustomer,
  type SubscriptionFacts,
} from './billing-store.js';

/** Reads a string field from an untyped Stripe object. */
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

/** Reads an id from a field that may be an id or an expanded object. */
const idOf = (value: unknown): string | undefined =>
  text(value) ?? (typeof value === 'object' && value !== null ? text((value as { id?: unknown }).id) : undefined);

/**
 * Plan status for a Stripe subscription status.
 *
 * @param status - Stripe's status.
 * @returns The plan status, or `undefined` while the first payment is still pending.
 */
export const planStatusFor = (status: string | undefined): PlanStatus | undefined => {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
    case 'paused':
      return 'canceled';
    default:
      return undefined;
  }
};

/**
 * Plan tier for a price lookup key.
 *
 * @param lookupKey - The price's lookup key, such as `premium_yearly`.
 * @returns The tier, or `undefined` for a price this app does not sell.
 */
export const tierForLookupKey = (lookupKey: string | undefined): PlanTier | undefined => {
  if (lookupKey?.startsWith('premium_') === true) return 'premium';
  if (lookupKey?.startsWith('org_extra_team') === true) return undefined;
  if (lookupKey?.startsWith('org_') === true) return 'organization';
  return undefined;
};

/**
 * Reduces a Stripe subscription object to plan facts.
 *
 * Newer API versions keep the period on each item, older ones on the
 * subscription; either is read. The plan is the item whose price is a base
 * plan; an organization's extra-team item is skipped.
 *
 * @param subscription - The subscription object from the event.
 * @returns The facts, or `undefined` when the plan cannot be told yet.
 */
export const subscriptionFacts = (subscription: Record<string, unknown>): SubscriptionFacts | undefined => {
  const items = (subscription.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [];
  const item = items.find((candidate) =>
    tierForLookupKey(text((candidate.price as { lookup_key?: unknown } | undefined)?.lookup_key)) !== undefined,
  );
  const price = item?.price as { lookup_key?: unknown; recurring?: { interval?: unknown } } | undefined;
  const tier = tierForLookupKey(text(price?.lookup_key));
  const status = planStatusFor(text(subscription.status));
  const subscriptionId = text(subscription.id);
  if (tier === undefined || status === undefined || subscriptionId === undefined) return undefined;
  const interval = text(price?.recurring?.interval);
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;
  return {
    tier,
    status,
    ...(interval === 'month' || interval === 'year' ? { interval: interval as BillingInterval } : {}),
    ...(typeof periodEnd === 'number' ? { currentPeriodEnd: new Date(periodEnd * 1000).toISOString() } : {}),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    subscriptionId,
  };
};

/**
 * Logs an event that was received but not applied.
 *
 * @param type - The Stripe event type.
 * @param reason - Why it was skipped.
 */
const skipped = (type: string, reason: string): void => {
  console.info(JSON.stringify({ service: 'billing', event: 'webhook_skipped', type, reason }));
};

/**
 * The team a billing object is for: its metadata, or its customer.
 *
 * @param object - A checkout session or subscription.
 * @returns The team id, when known.
 */
const teamFor = async (object: Record<string, unknown>): Promise<string | undefined> => {
  const fromMetadata = text((object.metadata as Record<string, unknown> | undefined)?.teamId);
  if (fromMetadata !== undefined) return fromMetadata;
  const customerId = idOf(object.customer);
  return customerId === undefined ? undefined : teamIdForCustomer(customerId);
};

/**
 * The organization a billing object is for: its metadata, or its customer.
 *
 * @param object - A checkout session or subscription.
 * @returns The organization id, when it is an organization's.
 */
const orgFor = async (object: Record<string, unknown>): Promise<string | undefined> => {
  const fromMetadata = text((object.metadata as Record<string, unknown> | undefined)?.orgId);
  if (fromMetadata !== undefined) return fromMetadata;
  const customerId = idOf(object.customer);
  return customerId === undefined ? undefined : orgIdForCustomer(customerId);
};

/**
 * Routes one verified event to its handler. Other event types are ignored.
 *
 * @param event - The verified Stripe event.
 */
export const applyBillingEvent = async (event: VerifiedStripeEvent): Promise<void> => {
  const object = event.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      if (object.mode !== 'subscription') return skipped(event.type, 'not_subscription');
      const orgId = await orgFor(object);
      if (orgId !== undefined) {
        const customer = idOf(object.customer);
        if (customer === undefined) return skipped(event.type, 'no_customer');
        await saveOrgBilling(orgId, customer, idOf(object.subscription));
        // Teams may have joined or left while the buyer was on the checkout page.
        await syncOrgSeats(orgId);
        return;
      }
      const teamId = await teamFor(object);
      const customerId = idOf(object.customer);
      if (teamId === undefined || customerId === undefined) return skipped(event.type, 'no_team');
      await saveTeamBilling(teamId, customerId, idOf(object.subscription));
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const orgId = await orgFor(object);
      if (orgId !== undefined) {
        const facts = subscriptionFacts(object);
        if (facts === undefined) return skipped(event.type, 'unknown_plan_or_pending');
        const customer = idOf(object.customer);
        if (customer !== undefined) await saveOrgBilling(orgId, customer, facts.subscriptionId);
        if (!(await applyOrgSubscription(orgId, facts, event.created))) skipped(event.type, 'stale');
        return;
      }
      const teamId = await teamFor(object);
      if (teamId === undefined) return skipped(event.type, 'no_team');
      const facts = subscriptionFacts(object);
      if (facts === undefined) return skipped(event.type, 'unknown_plan_or_pending');
      const customerId = idOf(object.customer);
      if (customerId !== undefined) await saveTeamBilling(teamId, customerId, facts.subscriptionId);
      const applied = await applySubscription(teamId, facts, event.created);
      if (!applied) skipped(event.type, 'stale_or_organization');
      return;
    }
    default:
      return skipped(event.type, 'unhandled_type');
  }
};
