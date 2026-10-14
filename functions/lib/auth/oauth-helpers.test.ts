/**
 * Unit tests for OAuth PKCE helpers.
 */

import { describe, expect, it } from 'vitest';
import { generateOAuthState, generatePkcePair, readOAuthIdClaims } from './oauth.js';

describe('oauth helpers', () => {
  it('builds a PKCE pair and state', () => {
    const state = generateOAuthState();
    const pair = generatePkcePair();
    expect(state.length).toBeGreaterThan(10);
    expect(pair.verifier.length).toBeGreaterThan(10);
    expect(pair.challenge.length).toBeGreaterThan(10);
    expect(pair.challenge).not.toBe(pair.verifier);
  });

  it('reads claims from an id token payload', () => {
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-1',
        email: 'a@example.com',
        name: 'Ada',
      }),
    ).toString('base64url');
    const token = `hdr.${payload}.sig`;
    expect(readOAuthIdClaims(token)).toEqual({
      userId: 'user-1',
      email: 'a@example.com',
      displayName: 'Ada',
    });
  });
});
