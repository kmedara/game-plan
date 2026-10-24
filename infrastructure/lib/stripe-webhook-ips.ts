/**
 * Stripe webhook delivery IPs for Lambda function URL resource policies.
 */

import stripeWebhookIps from '../data/stripe-webhook-ips.json';

export type StripeWebhookIpDocument = {
  source: string;
  fetchedAt: string;
  cidrs: string[];
};

/** Committed allowlist synced from Stripe's webhook IP feed. */
export const stripeWebhookIpDocument = stripeWebhookIps as StripeWebhookIpDocument;

/** CIDR strings passed to IAM `aws:SourceIp` conditions. */
export const stripeWebhookSourceCidrs = (): readonly string[] => stripeWebhookIpDocument.cidrs;

/**
 * Normalizes Stripe's webhook IP list for storage and IAM.
 *
 * @param ips - Host addresses from Stripe's `WEBHOOKS` array.
 * @returns Sorted unique CIDRs.
 */
export const stripeWebhookCidrsFromIps = (ips: readonly string[]): string[] =>
  [...new Set(ips.map((ip) => (ip.includes('/') ? ip : `${ip}/32`)))].sort();
