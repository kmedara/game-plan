/**
 * The Stripe calls the payments area makes, behind one small interface.
 *
 * Teams are Stripe Connect Express accounts. Dues are direct charges on the
 * team's account with an application fee for GamePlan, so Stripe's processing
 * fee comes out of the team's share and the platform fee arrives whole. Every
 * event about those charges is sent to the Connect webhook endpoint.
 */

import type Stripe from 'stripe';
import { stripeClient, verifyStripeEvent } from '../../lib/stripe-client.js';

/** Readiness flags Stripe reports for a connected account. */
export type AccountState = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

/** A hosted Checkout page for one due. */
export type CheckoutSession = {
  id: string;
  url: string;
  status: 'open' | 'complete' | 'expired';
};

/** Input for {@link PaymentGateway.createCheckoutSession}. */
export type CheckoutInput = {
  accountId: string;
  title: string;
  amountCents: number;
  currency: string;
  feeCents: number;
  payerEmail?: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

/** A verified webhook event, reduced to what the handlers read. */
export type GatewayEvent = {
  type: string;
  /** The connected account the event happened on. */
  account?: string;
  object: Record<string, unknown>;
};

/** Stripe operations used by the routes. Tests replace it with {@link setPaymentGateway}. */
export type PaymentGateway = {
  createAccount: (input: { teamId: string; email?: string }) => Promise<string>;
  getAccount: (accountId: string) => Promise<AccountState>;
  createAccountLink: (input: { accountId: string; refreshUrl: string; returnUrl: string }) => Promise<string>;
  createCheckoutSession: (input: CheckoutInput) => Promise<CheckoutSession>;
  getCheckoutSession: (accountId: string, sessionId: string) => Promise<CheckoutSession>;
  paymentIntentMetadata: (accountId: string, paymentIntentId: string) => Promise<Record<string, string>>;
  verifyWebhook: (rawBody: string, signature: string) => Promise<GatewayEvent>;
};

let override: PaymentGateway | undefined;

/** The shared Stripe client, reporting a missing key as `payments_not_configured`. */
const stripe = (): Promise<Stripe> => stripeClient('payments_not_configured');

/**
 * Reads the account flags from a Stripe account object.
 *
 * @param account - The Stripe account.
 * @returns The readiness flags.
 */
const stateOf = (account: Stripe.Account): AccountState => ({
  chargesEnabled: account.charges_enabled === true,
  payoutsEnabled: account.payouts_enabled === true,
  detailsSubmitted: account.details_submitted === true,
});

/**
 * Narrows a Checkout Session to the fields the routes use.
 *
 * @param session - The Stripe session.
 * @returns The session id, URL, and status.
 */
const sessionOf = (session: Stripe.Checkout.Session): CheckoutSession => ({
  id: session.id,
  url: session.url ?? '',
  status: session.status === 'complete' ? 'complete' : session.status === 'expired' ? 'expired' : 'open',
});

/** The live Stripe implementation. */
const stripeGateway: PaymentGateway = {
  createAccount: async ({ teamId, email }) => {
    const account = await (await stripe()).accounts.create(
      {
        type: 'express',
        ...(email !== undefined ? { email } : {}),
        metadata: { teamId },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      },
      { idempotencyKey: `account:${teamId}` },
    );
    return account.id;
  },
  getAccount: async (accountId) => stateOf(await (await stripe()).accounts.retrieve(accountId)),
  createAccountLink: async ({ accountId, refreshUrl, returnUrl }) => {
    const link = await (await stripe()).accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    return link.url;
  },
  createCheckoutSession: async (input) => {
    const session = await (await stripe()).checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency,
              unit_amount: input.amountCents,
              product_data: { name: input.title },
            },
          },
        ],
        payment_intent_data: {
          application_fee_amount: input.feeCents,
          metadata: input.metadata,
        },
        metadata: input.metadata,
        ...(input.payerEmail !== undefined ? { customer_email: input.payerEmail } : {}),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
      { stripeAccount: input.accountId, idempotencyKey: input.idempotencyKey },
    );
    return sessionOf(session);
  },
  getCheckoutSession: async (accountId, sessionId) =>
    sessionOf(await (await stripe()).checkout.sessions.retrieve(sessionId, {}, { stripeAccount: accountId })),
  paymentIntentMetadata: async (accountId, paymentIntentId) => {
    const intent = await (await stripe()).paymentIntents.retrieve(
      paymentIntentId,
      {},
      { stripeAccount: accountId },
    );
    return intent.metadata;
  },
  verifyWebhook: async (rawBody, signature) => {
    const event = await verifyStripeEvent({
      rawBody,
      signature,
      secretParameterEnv: 'STRIPE_WEBHOOK_SECRET_PARAMETER',
      secretLocalEnv: 'STRIPE_WEBHOOK_SECRET',
      notConfigured: 'payments_not_configured',
    });
    return {
      type: event.type,
      ...(event.account !== undefined ? { account: event.account } : {}),
      object: event.object,
    };
  },
};

/**
 * The gateway the routes call.
 *
 * @returns The test override when one is set, otherwise Stripe.
 */
export const paymentGateway = (): PaymentGateway => override ?? stripeGateway;

/**
 * Replaces the gateway, for tests. Pass `undefined` to restore Stripe.
 *
 * @param gateway - The stand-in.
 */
export const setPaymentGateway = (gateway: PaymentGateway | undefined): void => {
  override = gateway;
};

/**
 * GamePlan's cut of a payment, from `PLATFORM_FEE_BPS` (basis points, default 2%).
 *
 * @param amountCents - The due amount.
 * @returns The fee in minor units, rounded to the nearest unit.
 */
export const platformFeeCents = (amountCents: number): number => {
  const raw = Number(process.env.PLATFORM_FEE_BPS ?? '200');
  const bps = Number.isFinite(raw) && raw >= 0 && raw <= 1_000 ? raw : 200;
  return Math.round((amountCents * bps) / 10_000);
};
