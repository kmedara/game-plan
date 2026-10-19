/**
 * Applies verified Stripe events to dues and team accounts.
 *
 * Every handler is safe to run twice: Stripe retries until it gets a `2xx`,
 * and a replay finds the due already in the target state. An event is only
 * applied to a team whose connected account sent it.
 */

import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import { loadMemberNames } from '../../lib/chat-member-names.js';
import {
  getCharge,
  getDue,
  getStripeAccount,
  saveStripeAccount,
  teamIdForAccount,
  updateDue,
} from './payments-store.js';
import { paymentGateway, type GatewayEvent } from './stripe.js';

/** Metadata the checkout route puts on every session and payment intent. */
type DueMetadata = { teamId: string; chargeId: string; memberId: string; payerId?: string };

/**
 * Reads the due identifiers from Stripe metadata.
 *
 * @param value - A Stripe `metadata` object.
 * @returns The ids, or `undefined` when the payment was not for a due.
 */
const dueMetadata = (value: unknown): DueMetadata | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const { teamId, chargeId, memberId, payerId } = value as Record<string, unknown>;
  if (typeof teamId !== 'string' || typeof chargeId !== 'string' || typeof memberId !== 'string') {
    return undefined;
  }
  return { teamId, chargeId, memberId, ...(typeof payerId === 'string' ? { payerId } : {}) };
};

/**
 * Whether the event came from the team's own connected account.
 *
 * @param event - The verified event.
 * @param teamId - The team the metadata names.
 * @returns `false` when the account does not match.
 */
const fromTeamAccount = async (event: GatewayEvent, teamId: string): Promise<boolean> =>
  event.account !== undefined && (await getStripeAccount(teamId))?.accountId === event.account;

/**
 * Logs an event that was received but not applied.
 *
 * @param type - The Stripe event type.
 * @param reason - Why it was skipped.
 */
const skipped = (type: string, reason: string): void => {
  console.info(JSON.stringify({ service: 'payments', event: 'webhook_skipped', type, reason }));
};

/**
 * Marks a due paid from a completed checkout and tells whoever created the charge.
 *
 * @param event - `checkout.session.completed` or `checkout.session.async_payment_succeeded`.
 */
const onCheckoutPaid = async (event: GatewayEvent): Promise<void> => {
  const session = event.object;
  if (session.payment_status !== 'paid') return skipped(event.type, 'not_paid');
  const meta = dueMetadata(session.metadata);
  if (meta === undefined) return skipped(event.type, 'no_metadata');
  if (!(await fromTeamAccount(event, meta.teamId))) return skipped(event.type, 'account_mismatch');

  const due = await getDue(meta.teamId, meta.chargeId, meta.memberId);
  if (due === undefined) return skipped(event.type, 'due_not_found');
  const sessionId = typeof session.id === 'string' ? session.id : undefined;
  if (due.status === 'paid') {
    // A replay of the same session is expected. A second session paying the
    // same due is not; it needs a refund in the Stripe dashboard.
    if (due.checkoutSessionId !== sessionId) {
      console.warn(JSON.stringify({ service: 'payments', event: 'duplicate_payment', ...meta, sessionId }));
    }
    return;
  }

  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : undefined;
  await updateDue(due, {
    status: 'paid',
    paidBy: meta.payerId,
    paidAt: new Date().toISOString(),
    checkoutSessionId: sessionId,
    paymentIntentId,
  });

  const charge = await getCharge(meta.teamId, meta.chargeId);
  if (charge === undefined) return;
  const memberDisplayName = (await loadMemberNames([meta.memberId]))[meta.memberId];
  await enqueueFanout({
    type: 'payment_received',
    teamId: meta.teamId,
    chargeId: meta.chargeId,
    memberId: meta.memberId,
    title: charge.title.slice(0, 200),
    amountCents: due.amountCents,
    currency: charge.currency,
    ...(memberDisplayName !== undefined ? { memberDisplayName } : {}),
    userIds: [charge.createdBy],
  });
};

/**
 * Puts a due back to unpaid when its open checkout expires or fails.
 *
 * @param event - `checkout.session.expired` or `checkout.session.async_payment_failed`.
 */
const onCheckoutAbandoned = async (event: GatewayEvent): Promise<void> => {
  const meta = dueMetadata(event.object.metadata);
  if (meta === undefined) return skipped(event.type, 'no_metadata');
  if (!(await fromTeamAccount(event, meta.teamId))) return skipped(event.type, 'account_mismatch');
  const due = await getDue(meta.teamId, meta.chargeId, meta.memberId);
  if (due?.status !== 'pending' || due.checkoutSessionId !== event.object.id) return;
  await updateDue(due, { status: 'unpaid', checkoutSessionId: undefined });
};

/**
 * Marks a due refunded once its payment is refunded in full.
 *
 * @param event - `charge.refunded` from the team's account.
 */
const onChargeRefunded = async (event: GatewayEvent): Promise<void> => {
  const charge = event.object;
  if (charge.refunded !== true) return skipped(event.type, 'partial_refund');
  const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : undefined;
  if (paymentIntentId === undefined || event.account === undefined) {
    return skipped(event.type, 'no_payment_intent');
  }
  const meta = dueMetadata(await paymentGateway().paymentIntentMetadata(event.account, paymentIntentId));
  if (meta === undefined) return skipped(event.type, 'no_metadata');
  if (!(await fromTeamAccount(event, meta.teamId))) return skipped(event.type, 'account_mismatch');
  const due = await getDue(meta.teamId, meta.chargeId, meta.memberId);
  if (due?.status !== 'paid' || due.paymentIntentId !== paymentIntentId) return;
  await updateDue(due, { status: 'refunded', paidAt: undefined, paidBy: undefined });
};

/**
 * Copies a connected account's readiness flags onto its team.
 *
 * @param event - `account.updated`.
 */
const onAccountUpdated = async (event: GatewayEvent): Promise<void> => {
  const account = event.object;
  if (typeof account.id !== 'string') return skipped(event.type, 'no_account');
  const teamId = await teamIdForAccount(account.id);
  if (teamId === undefined) return skipped(event.type, 'unknown_account');
  await saveStripeAccount(teamId, account.id, {
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  });
};

/**
 * Routes one verified event to its handler. Other event types are ignored.
 *
 * @param event - The verified Stripe event.
 */
export const applyStripeEvent = async (event: GatewayEvent): Promise<void> => {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return onCheckoutPaid(event);
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      return onCheckoutAbandoned(event);
    case 'charge.refunded':
      return onChargeRefunded(event);
    case 'account.updated':
      return onAccountUpdated(event);
    default:
      return skipped(event.type, 'unhandled_type');
  }
};
