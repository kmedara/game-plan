/**
 * Unit tests for Cognito Hosted UI OAuth helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  decodeJwtPayload,
  exchangeAuthorizationCode,
  generateOAuthState,
  generatePkcePair,
  getAuthCallbackUrl,
  getCognitoOAuthConfig,
  readOAuthIdClaims,
} from './oauth.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('oauth module', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    delete process.env.COGNITO_CLIENT_ID;
    delete process.env.COGNITO_HOSTED_UI_DOMAIN;
    delete process.env.AUTH_CALLBACK_URL;
  });

  it('reads OAuth config and normalizes the hosted UI domain', () => {
    expect(() => getCognitoOAuthConfig()).toThrow('cognito_not_configured');

    process.env.COGNITO_CLIENT_ID = 'client-id';
    process.env.COGNITO_HOSTED_UI_DOMAIN = 'https://auth.example.com///';
    expect(getCognitoOAuthConfig()).toEqual({
      clientId: 'client-id',
      hostedUiDomain: 'auth.example.com',
      scope: 'openid email profile',
    });
  });

  it('uses AUTH_CALLBACK_URL when set', () => {
    process.env.AUTH_CALLBACK_URL = 'https://app.example/callback';
    expect(getAuthCallbackUrl()).toBe('https://app.example/callback');
    delete process.env.AUTH_CALLBACK_URL;
    expect(getAuthCallbackUrl()).toContain('/identity/oauth/callback');
  });

  it('builds authorize and logout URLs with PKCE material', () => {
    process.env.COGNITO_CLIENT_ID = 'client-id';
    process.env.COGNITO_HOSTED_UI_DOMAIN = 'auth.example.com';
    const state = generateOAuthState();
    const pair = generatePkcePair();
    const authorize = buildAuthorizeUrl({ state, challenge: pair.challenge });
    expect(authorize).toContain('auth.example.com/oauth2/authorize');
    expect(authorize).toContain(`state=${encodeURIComponent(state)}`);
    expect(buildLogoutUrl('https://app.example/logout')).toContain('/logout?');
  });

  it('exchanges an authorization code for tokens', async () => {
    process.env.COGNITO_CLIENT_ID = 'client-id';
    process.env.COGNITO_HOSTED_UI_DOMAIN = 'auth.example.com';

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
    });
    await expect(
      exchangeAuthorizationCode({ code: 'c', verifier: 'v' }),
    ).rejects.toThrow('oauth_token_exchange_failed');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'access-only' }),
    });
    await expect(
      exchangeAuthorizationCode({ code: 'c', verifier: 'v' }),
    ).rejects.toThrow('oauth_token_exchange_failed');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id_token: 'id',
        access_token: 'access',
        refresh_token: 'refresh',
      }),
    });
    await expect(exchangeAuthorizationCode({ code: 'c', verifier: 'v' })).resolves.toEqual({
      idToken: 'id',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3600,
    });
  });

  it('decodes JWT payloads and reads id-token claims', () => {
    expect(() => decodeJwtPayload('not-a-jwt')).toThrow('invalid_token');

    const payload = Buffer.from(JSON.stringify({ sub: 'u1', email: 'a@example.com' })).toString(
      'base64url',
    );
    expect(decodeJwtPayload(`h.${payload}.s`)).toMatchObject({ sub: 'u1' });

    expect(readOAuthIdClaims(`h.${payload}.s`)).toEqual({
      userId: 'u1',
      email: 'a@example.com',
      displayName: undefined,
    });

    const usernamePayload = Buffer.from(
      JSON.stringify({ sub: 'u2', 'cognito:username': 'AdaUsername' }),
    ).toString('base64url');
    expect(readOAuthIdClaims(`h.${usernamePayload}.s`)).toEqual({
      userId: 'u2',
      email: undefined,
      displayName: 'AdaUsername',
    });

    const missingSub = Buffer.from(JSON.stringify({ email: 'a@example.com' })).toString(
      'base64url',
    );
    expect(() => readOAuthIdClaims(`h.${missingSub}.s`)).toThrow('invalid_token');
  });
});
