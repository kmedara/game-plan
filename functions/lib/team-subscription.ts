/**
 * Ends a team's own subscription when it joins an organization, refunding the
 * unused part of the paid period to the card.
 *
 * Stripe turns an immediate prorated cancellation into a credit on the
 * customer's balance. That credit is refunded against the latest paid invoice
 * and the balance is brought back to zero, so the money is returned once.
 */

import type Stripe from 'stripe';
import { billingSk, getItem, teamPk } from './dynamo/index.js';
import { stripeClient } from './stripe-client.js';

/** `TEAM#<teamId>` / `BILLING`, as the billing area writes it. */
type TeamBillingItem = { teamId: string; customerId: string; subscriptionId?: string };

/** Cancels a subscription and refunds unused time. Tests replace it with {@link setSubscriptionCanceller}. */
export type SubscriptionCanceller = (input: { customerId: string; subscriptionId: string }) => Promise<{ refundedCents: number }>;

/** Subscription states that are still billing the team. */
const BILLING_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due', 'unpaid']);

/** The live Stripe implementation. */
const stripeCanceller: SubscriptionCanceller = async ({ customerId, subscriptionId }) => {
  const stripe: Stripe = await stripeClient('billing_not_configured');
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!BILLING_STATUSES.has(subscription.status)) return { refundedCents: 0 };
  const latestInvoiceId =
    typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id;

  await stripe.subscriptions.cancel(subscriptionId, { prorate: true, invoice_now: true });

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted === true) return { refundedCents: 0 };
  const credit = -customer.balance;
  if (credit <= 0 || latestInvoiceId === undefined) return { refundedCents: 0 };

  const payments = await stripe.invoicePayments.list({ invoice: latestInvoiceId, status: 'paid', limit: 1 });
  const paymentIntent = payments.data[0]?.payment.payment_intent;
  const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
  const paid = payments.data[0]?.amount_paid ?? 0;
  if (paymentIntentId === undefined || paid <= 0) return { refundedCents: 0 };

  const amount = Math.min(credit, paid);
  await stripe.refunds.create(
    { payment_intent: paymentIntentId, amount, reason: 'requested_by_customer', metadata: { subscriptionId, cause: 'joined_organization' } },
    { idempotencyKey: `org-join-refund:${subscriptionId}` },
  );
  await stripe.customers.createBalanceTransaction(
    customerId,
    { amount, currency: customer.currency ?? 'usd', description: 'Unused plan time refunded to card on joining an organization' },
    { idempotencyKey: `org-join-balance:${subscriptionId}` },
  );
  return { refundedCents: amount };
};

let override: SubscriptionCanceller | undefined;

/**
 * Replaces the Stripe calls, for tests. Pass `undefined` to restore Stripe.
 *
 * @param canceller - The stand-in.
 */
export const setSubscriptionCanceller = (canceller: SubscriptionCanceller | undefined): void => {
  override = canceller;
};

/**
 * Cancels the team's own subscription, if it has one, and refunds unused time.
 *
 * @param teamId - The team joining an organization.
 * @returns What was refunded, in minor units; `0` when the team was not paying.
 */
export const cancelTeamSubscription = async (teamId: string): Promise<{ refundedCents: number }> => {
  const billing = await getItem<TeamBillingItem>(teamPk(teamId), billingSk());
  if (billing?.subscriptionId === undefined) return { refundedCents: 0 };
  return (override ?? stripeCanceller)({ customerId: billing.customerId, subscriptionId: billing.subscriptionId });
};
