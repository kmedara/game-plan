/**
 * A team's Stripe Connect account: status and onboarding.
 */

import { paymentReturnBodySchema } from '@gameplan/schemas';
import { requireMembership, requirePermission, requireUser } from '../../../lib/guards.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation } from '../../../lib/pipeline.js';
import { accountResponse, getStripeAccount, saveStripeAccount } from '../payments-store.js';
import { stripeReturnUrl } from '../return-urls.js';
import { paymentGateway } from '../stripe.js';
import { withPaymentsErrors } from './errors.js';

/**
 * `GET /payments/teams/:teamId/account`
 *
 * Any member may see whether the team takes payments. Before charges are
 * enabled the flags are refreshed from Stripe, since onboarding finishes there.
 */
export const handleGetAccount = route(
  'GET',
  '/payments/teams/:teamId/account',
  withPaymentsErrors(),
  requireUser(),
  requireMembership(),
  async ({ teamId }) => {
    const stored = await getStripeAccount(teamId);
    if (stored === undefined || stored.chargesEnabled) {
      return json(200, accountResponse(teamId, stored));
    }
    const state = await paymentGateway().getAccount(stored.accountId);
    const changed =
      state.chargesEnabled !== stored.chargesEnabled ||
      state.payoutsEnabled !== stored.payoutsEnabled ||
      state.detailsSubmitted !== stored.detailsSubmitted;
    const current = changed ? await saveStripeAccount(teamId, stored.accountId, state) : stored;
    return json(200, accountResponse(teamId, current));
  },
);

/**
 * `POST /payments/teams/:teamId/account/link`
 *
 * Creates the team's Express account on first use, then returns a one-time
 * Stripe onboarding URL. Calling it again resumes onboarding or opens it to
 * update details.
 */
export const handleCreateAccountLink = route(
  'POST',
  '/payments/teams/:teamId/account/link',
  withPaymentsErrors(),
  requireUser(),
  withBodyValidation(paymentReturnBodySchema),
  requireMembership(),
  requirePermission('manage_payments'),
  async ({ teamId, user, body }) => {
    const gateway = paymentGateway();
    let stored = await getStripeAccount(teamId);
    if (stored === undefined) {
      const accountId = await gateway.createAccount({ teamId, email: user.email });
      stored = await saveStripeAccount(teamId, accountId, await gateway.getAccount(accountId));
    }
    const url = await gateway.createAccountLink({
      accountId: stored.accountId,
      refreshUrl: stripeReturnUrl({ to: body.returnTo, result: 'refresh', teamId }),
      returnUrl: stripeReturnUrl({ to: body.returnTo, result: 'onboarded', teamId }),
    });
    return json(200, { url });
  },
);
