/**
 * Stripe webhook IP list helpers.
 */

import { describe, expect, it } from 'vitest';
import { stripeWebhookCidrsFromIps, stripeWebhookSourceCidrs } from './stripe-webhook-ips';

describe('stripe webhook ips', () => {
  it('normalizes host addresses to /32 CIDRs', () => {
    expect(stripeWebhookCidrsFromIps(['54.187.216.72', '3.18.12.63/32', '3.18.12.63'])).toEqual([
      '3.18.12.63/32',
      '54.187.216.72/32',
    ]);
  });

  it('loads the committed allowlist', () => {
    expect(stripeWebhookSourceCidrs().length).toBeGreaterThan(0);
    expect(stripeWebhookSourceCidrs()[0]).toMatch(/\/\d+$/u);
  });
});
