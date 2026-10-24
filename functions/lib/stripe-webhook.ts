/**
 * A Stripe webhook route. Stripe signs the body; there is no bearer token.
 */

import { headerOf, json, rawBody } from './http.js';
import { route, type HttpRoute, type Step } from './pipeline.js';

/**
 * Builds `POST <path>` for one Stripe webhook endpoint.
 *
 * Verifies the `Stripe-Signature` header against the exact bytes received,
 * then applies the event. A `4xx` or `5xx` makes Stripe retry later.
 *
 * @param path - The route path, such as `/billing/webhook`.
 * @param options - The area's error step, its signature check, and what to do with the event.
 * @returns The route.
 */
export const stripeWebhookRoute = <Event>(
  path: `/${string}`,
  options: {
    errors: Step<object, object>;
    verify: (raw: string, signature: string) => Promise<Event>;
    apply: (event: Event) => Promise<void>;
  },
): HttpRoute =>
  route('POST', path, options.errors, async ({ event }) => {
    const signature = headerOf(event, 'stripe-signature');
    if (signature === undefined) throw new Error('invalid_signature');
    await options.apply(await options.verify(rawBody(event), signature));
    return json(200, { received: true });
  });
