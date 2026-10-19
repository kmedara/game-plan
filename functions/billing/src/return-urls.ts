/**
 * URLs Stripe sends the browser back to after checkout or the billing portal.
 *
 * Stripe always returns to the fixed `GET /billing/return` route with a target
 * from a closed list, never a URL from the client, so the route cannot be used
 * as an open redirect.
 */

import type { BillingReturnQuery } from '@gameplan/types';

/** Deep link the native app waits for in its browser session. */
export const NATIVE_BILLING_REDIRECT = 'gameplan://billing';

/** The public URL of `GET /billing/return`. */
const returnRouteUrl = (): string =>
  (process.env.BILLING_RETURN_URL ?? 'http://localhost:4200/api/billing/return').replace(/\/+$/u, '');

/** The website origin. */
const clientOrigin = (): string => (process.env.CLIENT_ORIGIN ?? 'http://localhost:4200').replace(/\/+$/u, '');

/**
 * The URL to hand Stripe for one outcome.
 *
 * @param query - Target, result, and the team.
 * @returns An absolute URL on the API.
 */
export const billingReturnUrl = (query: BillingReturnQuery): string => {
  const params = new URLSearchParams({ to: query.to, result: query.result });
  if (query.teamId !== undefined) params.set('teamId', query.teamId);
  return `${returnRouteUrl()}?${params.toString()}`;
};

/**
 * Where `GET /billing/return` redirects.
 *
 * @param query - The validated query Stripe sent back.
 * @returns The app deep link, or the team's page on the website.
 */
export const billingLandingUrl = (query: BillingReturnQuery): string => {
  const params = new URLSearchParams({ result: query.result });
  if (query.teamId !== undefined) params.set('teamId', query.teamId);
  if (query.to === 'app') return `${NATIVE_BILLING_REDIRECT}?${params.toString()}`;
  const path = query.teamId !== undefined ? `/teams/${encodeURIComponent(query.teamId)}` : '/plans';
  return `${clientOrigin()}${path}?${params.toString()}`;
};
