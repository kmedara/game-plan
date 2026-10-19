/**
 * The Stripe client and webhook check shared by the payments and billing areas.
 *
 * Both use the platform's secret key. Each webhook endpoint has its own
 * signing secret, named by the caller.
 */

import Stripe from 'stripe';
import { readSecret } from './parameters.js';

let client: Stripe | undefined;

/**
 * The Stripe client, built from the secret key on first use.
 *
 * @param notConfigured - Error code to throw when no key is set, such as `payments_not_configured`.
 * @returns The client.
 */
export const stripeClient = async (notConfigured: string): Promise<Stripe> => {
  if (client !== undefined) return client;
  const key = await readSecret('STRIPE_SECRET_KEY_PARAMETER', 'STRIPE_SECRET_KEY');
  if (key === undefined) throw new Error(notConfigured);
  client = new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: 'GamePlan' } });
  return client;
};

/** A verified webhook event, reduced to what the handlers read. */
export type VerifiedStripeEvent = {
  id: string;
  type: string;
  /** Unix seconds when Stripe created the event; used to drop out-of-order deliveries. */
  created: number;
  /** The connected account the event happened on, for Connect endpoints. */
  account?: string;
  object: Record<string, unknown>;
};

/**
 * Checks a webhook signature against the exact bytes received.
 *
 * The signing secret may hold several values, comma-separated, while one is
 * being rolled.
 *
 * @param input - Raw body, `Stripe-Signature` header, and where the secret lives.
 * @returns The verified event.
 * @throws `invalid_signature`, or `notConfigured` when no secret is set.
 */
export const verifyStripeEvent = async (input: {
  rawBody: string;
  signature: string;
  secretParameterEnv: string;
  secretLocalEnv: string;
  notConfigured: string;
}): Promise<VerifiedStripeEvent> => {
  const raw = await readSecret(input.secretParameterEnv, input.secretLocalEnv);
  const secrets = (raw ?? '')
    .split(',')
    .map((secret) => secret.trim())
    .filter((secret) => secret.length > 0);
  if (secrets.length === 0) throw new Error(input.notConfigured);
  const api = await stripeClient(input.notConfigured);
  for (const secret of secrets) {
    try {
      const event = await api.webhooks.constructEventAsync(input.rawBody, input.signature, secret);
      return {
        id: event.id,
        type: event.type,
        created: event.created,
        ...(event.account !== undefined ? { account: event.account } : {}),
        object: event.data.object as unknown as Record<string, unknown>,
      };
    } catch {
      // Try the next secret; a roll keeps the old one valid for a while.
    }
  }
  throw new Error('invalid_signature');
};
