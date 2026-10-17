/**
 * CloudFront signed URLs for media served from the website distribution.
 *
 * URLs use a canned policy: an RSA-SHA1 signature over the resource and an
 * expiry. The expiry is rounded up to a window boundary, so every request for
 * the same object in one window gets the same URL and the viewer's image cache
 * can reuse it. CloudFront drops the signature query string from its cache key,
 * so the edge cache is shared across windows and users.
 */

import { createSign } from 'node:crypto';

/** Every URL issued within one window of this length gets the same expiry. */
export const CDN_URL_WINDOW_SECONDS = 60 * 60;

/** Object key prefix the website distribution serves from the media bucket. */
export const CDN_KEY_PREFIX = 'uploads/';

/**
 * Expiry for a URL issued at `nowMs`: the end of the next window, so a URL is
 * always valid for at least one full window.
 *
 * @param nowMs - Current time in epoch milliseconds.
 * @returns Expiry in epoch seconds.
 */
export const cdnExpiry = (nowMs: number): number =>
  (Math.floor(nowMs / 1000 / CDN_URL_WINDOW_SECONDS) + 2) * CDN_URL_WINDOW_SECONDS;

/**
 * Base64 with the characters CloudFront substitutes in query strings.
 *
 * @param base64 - Standard base64.
 * @returns The CloudFront-safe form.
 */
const cloudFrontBase64 = (base64: string): string =>
  base64.replace(/\+/gu, '-').replace(/=/gu, '_').replace(/\//gu, '~');

/**
 * Signs a URL with a canned policy.
 *
 * @param url - Absolute URL with no query string.
 * @param keyPairId - CloudFront public key id in the distribution's trusted key group.
 * @param privateKeyPem - Matching RSA private key in PEM form.
 * @param expiresAt - Expiry in epoch seconds.
 * @returns The signed URL.
 */
export const signCloudFrontUrl = (
  url: string,
  keyPairId: string,
  privateKeyPem: string,
  expiresAt: number,
): string => {
  // CloudFront rebuilds this exact string, so it must have no whitespace and this key order.
  const policy = JSON.stringify({
    Statement: [{ Resource: url, Condition: { DateLessThan: { 'AWS:EpochTime': expiresAt } } }],
  });
  const signature = createSign('RSA-SHA1').update(policy).sign(privateKeyPem, 'base64');
  return `${url}?Expires=${expiresAt}&Signature=${cloudFrontBase64(signature)}&Key-Pair-Id=${keyPairId}`;
};
