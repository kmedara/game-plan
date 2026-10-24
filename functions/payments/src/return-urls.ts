/**
 * URLs Stripe sends the browser back to, and where those land.
 *
 * See `lib/stripe-return.ts` for why the return route is not an open redirect.
 */

import type { PaymentReturnQuery } from '@gameplan/types';
import { stripeLandingUrl, stripeReturnUrl as returnUrlFor } from '../../lib/stripe-return.js';

/** Deep link the native app waits for in its browser session. */
export const NATIVE_PAYMENTS_REDIRECT = 'gameplan://payments';

/**
 * The URL to hand Stripe for one outcome.
 *
 * @param query - Target, result, and the team for onboarding.
 * @returns An absolute URL on the API.
 */
export const stripeReturnUrl = (query: PaymentReturnQuery): string =>
  returnUrlFor(process.env.PAYMENTS_RETURN_URL ?? 'http://localhost:4200/api/payments/return', query);

/**
 * Where `GET /payments/return` redirects.
 *
 * @param query - The validated query Stripe sent back.
 * @returns The app deep link, or the matching website page.
 */
export const landingUrl = (query: PaymentReturnQuery): string => {
  const onboarding = query.result === 'onboarded' || query.result === 'refresh';
  return stripeLandingUrl(
    NATIVE_PAYMENTS_REDIRECT,
    onboarding && query.teamId !== undefined
      ? `/teams/${encodeURIComponent(query.teamId)}/payments`
      : '/dues',
    query,
  );
};
