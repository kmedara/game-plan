/**
 * URLs Stripe sends the browser back to, and where those land.
 *
 * Stripe always returns to the fixed `GET /payments/return` route with a target
 * from a closed list, never a URL from the client, so the route cannot be used
 * as an open redirect.
 */

import type { PaymentReturnQuery } from '@gameplan/types';

/** Deep link the native app waits for in its browser session. */
export const NATIVE_PAYMENTS_REDIRECT = 'gameplan://payments';

/** The public URL of `GET /payments/return`. */
const returnRouteUrl = (): string =>
  (process.env.PAYMENTS_RETURN_URL ?? 'http://localhost:4200/api/payments/return').replace(/\/+$/u, '');

/** The website origin. */
const clientOrigin = (): string =>
  (process.env.CLIENT_ORIGIN ?? 'http://localhost:4200').replace(/\/+$/u, '');

/**
 * The URL to hand Stripe for one outcome.
 *
 * @param query - Target, result, and the team for onboarding.
 * @returns An absolute URL on the API.
 */
export const stripeReturnUrl = (query: PaymentReturnQuery): string => {
  const params = new URLSearchParams({ to: query.to, result: query.result });
  if (query.teamId !== undefined) params.set('teamId', query.teamId);
  return `${returnRouteUrl()}?${params.toString()}`;
};

/**
 * Where `GET /payments/return` redirects.
 *
 * @param query - The validated query Stripe sent back.
 * @returns The app deep link, or the matching website page.
 */
export const landingUrl = (query: PaymentReturnQuery): string => {
  const params = new URLSearchParams({ result: query.result });
  if (query.teamId !== undefined) params.set('teamId', query.teamId);
  if (query.to === 'app') return `${NATIVE_PAYMENTS_REDIRECT}?${params.toString()}`;
  const onboarding = query.result === 'onboarded' || query.result === 'refresh';
  const path =
    onboarding && query.teamId !== undefined
      ? `/teams/${encodeURIComponent(query.teamId)}/payments`
      : '/dues';
  return `${clientOrigin()}${path}?${params.toString()}`;
};
