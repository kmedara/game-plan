/**
 * Fetches Stripe webhook source IPs and writes infrastructure/data/stripe-webhook-ips.json.
 * Used by the scheduled GitHub workflow; safe to run locally.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://stripe.com/files/ips/ips_webhooks.json';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '../data/stripe-webhook-ips.json');

/**
 * @param {string} ip
 * @returns {string}
 */
const toCidr = (ip) => (ip.includes('/') ? ip : `${ip}/32`);

/**
 * @param {unknown} body
 * @returns {string[]}
 */
const cidrsFromStripe = (body) => {
  if (typeof body !== 'object' || body === null || !('WEBHOOKS' in body)) {
    throw new Error('Stripe webhook IP JSON missing WEBHOOKS array');
  }
  const list = body.WEBHOOKS;
  if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
    throw new Error('Stripe WEBHOOKS must be a string array');
  }
  return [...new Set(list.map(toCidr))].sort();
};

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
const sameDocument = (left, right) => JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right));

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`Failed to fetch ${SOURCE_URL}: ${response.status}`);
}
const stripeBody = await response.json();
const cidrs = cidrsFromStripe(stripeBody);
const document = {
  source: SOURCE_URL,
  fetchedAt: new Date().toISOString(),
  cidrs,
};
const next = `${JSON.stringify(document, null, 2)}\n`;

let previous = '';
try {
  previous = await readFile(OUT_PATH, 'utf8');
} catch (error) {
  if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
}

if (sameDocument(previous, next)) {
  console.log('stripe-webhook-ips.json is already up to date');
} else {
  await writeFile(OUT_PATH, next, 'utf8');
  console.log(`Updated ${OUT_PATH} (${cidrs.length} CIDRs)`);
}
