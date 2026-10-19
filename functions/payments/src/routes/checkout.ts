/**
 * Paying dues: the caller's list, Stripe Checkout, and the return redirect.
 */

import { canPayDue } from '@gameplan/rules';
import { paymentReturnBodySchema, paymentReturnQuerySchema } from '@gameplan/schemas';
import { getProfile } from '../../../lib/auth/index.js';
import { listChildIds, listGuardianIds } from '../../../lib/guardians.js';
import { requireUser } from '../../../lib/guards.js';
import { json, redirect } from '../../../lib/http.js';
import { route, withBodyValidation, withQueryValidation } from '../../../lib/pipeline.js';
import {
  getCharge,
  getDue,
  getStripeAccount,
  isOutstanding,
  listDuesForMembers,
  updateDue,
} from '../payments-store.js';
import { landingUrl, stripeReturnUrl } from '../return-urls.js';
import { paymentGateway, platformFeeCents } from '../stripe.js';
import { withPaymentsErrors } from './errors.js';

/**
 * `GET /payments/me/dues`
 *
 * The caller's own dues and those of every child they are a guardian of.
 */
export const handleListMyDues = route(
  'GET',
  '/payments/me/dues',
  withPaymentsErrors(),
  requireUser(),
  async ({ user }) => {
    const [profile, childIds] = await Promise.all([getProfile(user.userId), listChildIds(user.userId)]);
    const payable = new Set(childIds);
    if (profile?.accountKind === 'adult') payable.add(user.userId);
    const dues = await listDuesForMembers([user.userId, ...childIds], payable);
    return json(200, { dues });
  },
);

/**
 * `POST /payments/teams/:teamId/charges/:chargeId/dues/:memberId/checkout`
 *
 * Opens a Stripe Checkout page for one due. An adult pays their own; a
 * minor's guardian pays theirs. The payer need not be on the team. A checkout
 * that is still open is reused, so two taps cannot charge twice.
 */
export const handleCreateCheckout = route(
  'POST',
  '/payments/teams/:teamId/charges/:chargeId/dues/:memberId/checkout',
  withPaymentsErrors(),
  requireUser(),
  withBodyValidation(paymentReturnBodySchema),
  async ({ teamId, chargeId, memberId, user, body }) => {
    const [due, charge, member] = await Promise.all([
      getDue(teamId, chargeId, memberId),
      getCharge(teamId, chargeId),
      getProfile(memberId),
    ]);
    if (due === undefined || charge === undefined || member === undefined) {
      throw new Error('due_not_found');
    }
    const guardianIds = member.accountKind === 'minor' ? await listGuardianIds(memberId) : [];
    if (!canPayDue(user.userId, { userId: memberId, accountKind: member.accountKind, guardianIds })) {
      throw new Error('not_payer');
    }
    if (!isOutstanding(due.status)) throw new Error('due_settled');

    const account = await getStripeAccount(teamId);
    if (account?.chargesEnabled !== true) throw new Error('payments_not_enabled');

    const gateway = paymentGateway();
    if (due.status === 'pending' && due.checkoutSessionId !== undefined) {
      const open = await gateway.getCheckoutSession(account.accountId, due.checkoutSessionId);
      if (open.status === 'open' && open.url.length > 0) return json(200, { url: open.url });
      if (open.status === 'complete') throw new Error('due_settled');
    }

    const payer = user.userId === memberId ? member : await getProfile(user.userId);
    const session = await gateway.createCheckoutSession({
      accountId: account.accountId,
      title: charge.title,
      amountCents: due.amountCents,
      currency: charge.currency,
      feeCents: platformFeeCents(due.amountCents),
      ...(payer?.email !== undefined ? { payerEmail: payer.email } : {}),
      metadata: { teamId, chargeId, memberId, payerId: user.userId },
      successUrl: stripeReturnUrl({ to: body.returnTo, result: 'success' }),
      cancelUrl: stripeReturnUrl({ to: body.returnTo, result: 'cancel' }),
      idempotencyKey: `checkout:${teamId}:${chargeId}:${memberId}:${due.version}:${body.returnTo}`,
    });
    await updateDue(due, { status: 'pending', checkoutSessionId: session.id });
    return json(200, { url: session.url });
  },
);

/**
 * `GET /payments/return`
 *
 * The fixed URL handed to Stripe. Sends the browser on to the app deep link or
 * the website page that matches the outcome. Needs no sign-in.
 */
export const handlePaymentReturn = route(
  'GET',
  '/payments/return',
  withPaymentsErrors(),
  withQueryValidation(paymentReturnQuerySchema),
  async ({ query }) => redirect(landingUrl(query)),
);
