/**
 * URLs Stripe sends the browser back to, and where those land.
 *
 * Stripe always returns to a fixed `GET /<area>/return` route with a target
 * from a closed list, never a URL from the client, so the route cannot be used
 * as an open redirect. Each area decides which website page an outcome opens.
 */

import { clientOrigin } from './client-origin.js';

/** The fields every Stripe return carries. */
export type StripeReturnQuery = {
  to: string;
  result: string;
  teamId?: string;
  orgId?: string;
};

/**
 * Adds the team and organization ids a return carries.
 *
 * @param base - Fields that always go first.
 * @param query - The return query.
 * @returns The search params.
 */
const returnParams = (base: Record<string, string>, query: StripeReturnQuery): URLSearchParams => {
  const params = new URLSearchParams(base);
  if (query.teamId !== undefined) params.set('teamId', query.teamId);
  if (query.orgId !== undefined) params.set('orgId', query.orgId);
  return params;
};

/**
 * Builds the URL to hand Stripe for one outcome.
 *
 * @param routeUrl - The public URL of the area's return route.
 * @param query - Target, result, and ids.
 * @returns An absolute URL on the API.
 */
export const stripeReturnUrl = (routeUrl: string, query: StripeReturnQuery): string =>
  `${routeUrl.replace(/\/+$/u, '')}?${returnParams({ to: query.to, result: query.result }, query).toString()}`;

/**
 * Builds where the return route redirects.
 *
 * @param nativeRedirect - The deep link the native app waits for.
 * @param websitePath - The website page for this outcome.
 * @param query - The validated query Stripe sent back.
 * @returns The app deep link, or the website page.
 */
export const stripeLandingUrl = (
  nativeRedirect: string,
  websitePath: string,
  query: StripeReturnQuery,
): string => {
  const params = returnParams({ result: query.result }, query).toString();
  if (query.to === 'app') return `${nativeRedirect}?${params}`;
  return `${clientOrigin()}${websitePath}?${params}`;
};
