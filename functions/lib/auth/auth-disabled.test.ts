/**
 * Unit tests for AUTH_DISABLED seed auth and OAuth PKCE helpers.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { isAuthDisabled, seedUserId } from './auth-disabled.js';
import { generateOAuthState, generatePkcePair, readOAuthIdClaims } from './oauth.js';

describe('AUTH_DISABLED', () => {
  afterEach(() => {
    delete process.env.AUTH_DISABLED;
    delete process.env.AUTH_SEED_USER_ID;
  });

  it('is off unless AUTH_DISABLED is the string true', () => {
    expect(isAuthDisabled()).toBe(false);
    process.env.AUTH_DISABLED = 'false';
    expect(isAuthDisabled()).toBe(false);
    process.env.AUTH_DISABLED = 'true';
    expect(isAuthDisabled()).toBe(true);
  });

  it('requires AUTH_SEED_USER_ID when auth is disabled', () => {
    process.env.AUTH_DISABLED = 'true';
    expect(() => seedUserId()).toThrow('seed_user_id_required');
  });

  it('reads AUTH_SEED_USER_ID', () => {
    process.env.AUTH_SEED_USER_ID = '44444444-4444-4444-8444-444444444444';
    expect(seedUserId()).toBe('44444444-4444-4444-8444-444444444444');
  });
});

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
