/**
 * The Stripe Billing calls the billing area makes, behind one small interface.
 *
 * Subscriptions are on the platform account (not a team's Connect account).
 * Prices are found by lookup key, so the same code runs against test and live
 * mode and a price change needs no deploy.
 */

import type Stripe from 'stripe';
import type { BillingInterval } from '@gameplan/types';
import { stripeClient, verifyStripeEvent, type VerifiedStripeEvent } from '../../lib/stripe-client.js';

/** Stripe price lookup keys for the premium team plan. */
export const PREMIUM_LOOKUP_KEYS: Readonly<Record<BillingInterval, string>> = {
  month: 'premium_monthly',
  year: 'premium_yearly',
};

/** Stripe price lookup keys for the organization plan. */
export const ORG_LOOKUP_KEYS: Readonly<Record<BillingInterval, string>> = {
  month: 'org_monthly',
  year: 'org_yearly',
};

/**
 * Price for each organization team past the included ones, as a second
 * subscription item. Stripe requires every item on a subscription to renew on
 * the same interval, so a yearly organization pays the yearly price ($5 x 12).
 */
export const ORG_EXTRA_TEAM_LOOKUP_KEYS: Readonly<Record<BillingInterval, string>> = {
  month: 'org_extra_team_monthly',
  year: 'org_extra_team_yearly',
};

/** Input for {@link BillingGateway.createCheckoutSession}. */
export type SubscriptionCheckoutInput = {
  priceId: string;
  /** More priced items, such as extra organization teams. */
  extraItems?: { priceId: string; quantity: number }[];
  customerId?: string;
  email?: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
};

/** Stripe operations used by the routes. Tests replace it with {@link setBillingGateway}. */
export type BillingGateway = {
  priceId: (lookupKey: string) => Promise<string>;
  createCheckoutSession: (input: SubscriptionCheckoutInput) => Promise<{ url: string }>;
  createPortalSession: (customerId: string, returnUrl: string) => Promise<{ url: string }>;
  verifyWebhook: (rawBody: string, signature: string) => Promise<VerifiedStripeEvent>;
};

/** The shared Stripe client, reporting a missing key as `billing_not_configured`. */
const stripe = (): Promise<Stripe> => stripeClient('billing_not_configured');

/** Price ids by lookup key; prices rarely change within a warm container. */
const priceIds = new Map<string, string>();

/** The live Stripe implementation. */
const stripeGateway: BillingGateway = {
  priceId: async (lookupKey) => {
    const cached = priceIds.get(lookupKey);
    if (cached !== undefined) return cached;
    const prices = await (await stripe()).prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const price = prices.data[0];
    if (price === undefined) throw new Error('billing_not_configured');
    priceIds.set(lookupKey, price.id);
    return price.id;
  },
  createCheckoutSession: async (input) => {
    const session = await (await stripe()).checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        { price: input.priceId, quantity: 1 },
        ...(input.extraItems ?? []).map((item) => ({ price: item.priceId, quantity: item.quantity })),
      ],
      ...(input.customerId !== undefined
        ? { customer: input.customerId }
        : input.email !== undefined
          ? { customer_email: input.email }
          : {}),
      client_reference_id: input.metadata.teamId ?? input.metadata.orgId,
      metadata: input.metadata,
      subscription_data: { metadata: input.metadata },
      allow_promotion_codes: true,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    if (session.url === null) throw new Error('billing_not_configured');
    return { url: session.url };
  },
  createPortalSession: async (customerId, returnUrl) => {
    const session = await (await stripe()).billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { url: session.url };
  },
  verifyWebhook: (rawBody, signature) =>
    verifyStripeEvent({
      rawBody,
      signature,
      secretParameterEnv: 'STRIPE_BILLING_WEBHOOK_SECRET_PARAMETER',
      secretLocalEnv: 'STRIPE_BILLING_WEBHOOK_SECRET',
      notConfigured: 'billing_not_configured',
    }),
};

let override: BillingGateway | undefined;

/**
 * The gateway the routes call.
 *
 * @returns The test override when one is set, otherwise Stripe.
 */
export const billingGateway = (): BillingGateway => override ?? stripeGateway;

/**
 * Replaces the gateway, for tests. Pass `undefined` to restore Stripe.
 *
 * @param gateway - The stand-in.
 */
export const setBillingGateway = (gateway: BillingGateway | undefined): void => {
  override = gateway;
};
