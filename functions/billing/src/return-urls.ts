/**
 * URLs Stripe sends the browser back to after checkout or the billing portal.
 *
 * See `lib/stripe-return.ts` for why the return route is not an open redirect.
 */

import type { BillingReturnQuery } from '@gameplan/types';
import { stripeLandingUrl, stripeReturnUrl } from '../../lib/stripe-return.js';

/** Deep link the native app waits for in its browser session. */
export const NATIVE_BILLING_REDIRECT = 'gameplan://billing';

/**
 * The URL to hand Stripe for one outcome.
 *
 * @param query - Target, result, and the team.
 * @returns An absolute URL on the API.
 */
export const billingReturnUrl = (query: BillingReturnQuery): string =>
  stripeReturnUrl(process.env.BILLING_RETURN_URL ?? 'http://localhost:4200/api/billing/return', query);

/**
 * Where `GET /billing/return` redirects.
 *
 * @param query - The validated query Stripe sent back.
 * @returns The app deep link, or the team's page on the website.
 */
export const billingLandingUrl = (query: BillingReturnQuery): string =>
  stripeLandingUrl(
    NATIVE_BILLING_REDIRECT,
    query.teamId !== undefined
      ? `/teams/${encodeURIComponent(query.teamId)}`
      : query.orgId !== undefined
        ? `/orgs/${encodeURIComponent(query.orgId)}`
        : '/plans',
    query,
  );
