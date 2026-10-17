/**
 * CloudFront canned-policy signing and window-rounded expiry.
 */

import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CDN_URL_WINDOW_SECONDS, cdnExpiry, signCloudFrontUrl } from './cdn-url.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

describe('cdnExpiry', () => {
  it('gives every time in one window the same expiry, at least a window away', () => {
    const windowMs = CDN_URL_WINDOW_SECONDS * 1000;
    const start = 1_800_000 * windowMs;
    const expiry = cdnExpiry(start);
    expect(cdnExpiry(start + windowMs - 1)).toBe(expiry);
    expect(expiry * 1000 - (start + windowMs - 1)).toBeGreaterThan(windowMs - 1);
    expect(cdnExpiry(start + windowMs)).toBe(expiry + CDN_URL_WINDOW_SECONDS);
  });
});

describe('signCloudFrontUrl', () => {
  it('signs the canned policy CloudFront rebuilds from the URL', () => {
    const url = 'https://site.example.com/uploads/u1/photo';
    const signed = new URL(signCloudFrontUrl(url, 'K123', privateKey, 1_900_000_000));

    expect(`${signed.origin}${signed.pathname}`).toBe(url);
    expect(signed.searchParams.get('Expires')).toBe('1900000000');
    expect(signed.searchParams.get('Key-Pair-Id')).toBe('K123');
    const signature = signed.searchParams.get('Signature') ?? '';
    expect(signature).not.toMatch(/[+=/]/u);

    const policy = `{"Statement":[{"Resource":"${url}","Condition":{"DateLessThan":{"AWS:EpochTime":1900000000}}}]}`;
    const standard = signature.replace(/-/gu, '+').replace(/_/gu, '=').replace(/~/gu, '/');
    expect(createVerify('RSA-SHA1').update(policy).verify(publicKey, standard, 'base64')).toBe(true);
  });

  it('returns the same URL for the same object within one window', () => {
    const url = 'https://site.example.com/uploads/u1/photo';
    const now = Date.now();
    expect(signCloudFrontUrl(url, 'K', privateKey, cdnExpiry(now))).toBe(
      signCloudFrontUrl(url, 'K', privateKey, cdnExpiry(now)),
    );
  });
});
