/**
 * Identity OAuth, complete-profile, seed-session, and session error coverage.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserProfileItem } from '../../lib/auth/identity-provider.js';
import { issueLocalTokens, signLocalJwt } from '../../lib/auth/local-jwt.js';
import { REFRESH_COOKIE } from '../../lib/auth/refresh-cookie.js';
import { resetIdentityProvider, setIdentityProvider } from '../../lib/auth/provider.js';
import type { IdentityProvider, IdentityTokens } from '../../lib/auth/identity-provider.js';
import {
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  oauthClearCookie,
  oauthSetCookie,
} from './routes/oauth-cookies.js';
import { mapError } from './routes/session.js';
import { pendingProfile } from './routes/oauth.js';

const profiles = new Map<string, UserProfileItem>();
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('../../lib/auth/profile.js', () => ({
  getProfile: async (userId: string) => profiles.get(userId),
  putProfile: async (input: {
    userId: string;
    email: string;
    displayName: string;
    accountKind: 'adult' | 'minor';
    birthday?: string;
    photoKey?: string | null;
    createdAt?: string;
    passwordHash?: string;
  }) => {
    const item: UserProfileItem = {
      PK: `USER#${input.userId}`,
      SK: 'PROFILE',
      userId: input.userId,
      email: input.email,
      displayName: input.displayName,
      accountKind: input.accountKind,
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...(input.birthday !== undefined ? { birthday: input.birthday } : {}),
      ...(input.photoKey ? { photoKey: input.photoKey } : {}),
      ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
    };
    profiles.set(input.userId, item);
    return item;
  },
  findProfileByEmail: async () => undefined,
}));

const { handler } = await import('./handler.js');

/**
 * Builds a minimal HTTP API event for identity routes.
 *
 * @param method - The HTTP method.
 * @param path - The request path.
 * @param options - Optional query, headers, cookies, and body.
 * @returns An HTTP API event.
 */
const httpEvent = (
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    cookies?: string[];
    query?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.headers ?? {},
    cookies: options.cookies,
    queryStringParameters: options.query,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

/**
 * Seeds a profile row for OAuth and AUTH_DISABLED tests.
 *
 * @param userId - The user id.
 * @param email - The email address.
 * @param birthday - Optional birthday (omit for incomplete profile).
 */
const seedProfile = (
  userId: string,
  email: string,
  birthday?: string,
): void => {
  profiles.set(userId, {
    PK: `USER#${userId}`,
    SK: 'PROFILE',
    userId,
    email,
    displayName: 'Seed User',
    accountKind: 'adult',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...(birthday !== undefined ? { birthday } : {}),
  });
};

/**
 * Builds a compact unsigned JWT payload for id-token claim parsing.
 *
 * @param payload - Claims object.
 * @returns A three-part JWT string.
 */
const fakeJwt = (payload: Record<string, unknown>): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
};

/**
 * Builds a memory identity provider for refresh/logout edge cases.
 *
 * @returns An identity provider.
 */
const memoryProvider = (): IdentityProvider => {
  const tokensFor = (userId: string, email: string): IdentityTokens => {
    const issued = issueLocalTokens(userId, email);
    return { ...issued, userId, email };
  };
  return {
    async register() {
      throw new Error('unused');
    },
    async login() {
      throw new Error('unused');
    },
    async refresh(refreshToken) {
      const { verifyLocalJwt } = await import('../../lib/auth/local-jwt.js');
      const claims = verifyLocalJwt(refreshToken);
      if (claims.token_use !== 'refresh') throw new Error('invalid_token');
      return tokensFor(claims.sub, claims.email ?? '');
    },
    async logout() {
      throw new Error('logout_failed');
    },
  };
};

describe('identity oauth and session edges', () => {
  beforeEach(() => {
    profiles.clear();
    fetchMock.mockReset();
    delete process.env.AUTH_DISABLED;
    delete process.env.AUTH_SEED_USER_ID;
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    delete process.env.COGNITO_HOSTED_UI_DOMAIN;
    delete process.env.CLIENT_ORIGIN;
    delete process.env.NODE_ENV;
    process.env.LOCAL_JWT_SECRET = 'oauth-test-secret';
    resetIdentityProvider();
    setIdentityProvider(memoryProvider());
  });

  afterEach(() => {
    resetIdentityProvider();
    delete process.env.AUTH_DISABLED;
    delete process.env.AUTH_SEED_USER_ID;
    delete process.env.NODE_ENV;
  });

  it('covers oauth cookie helpers in production and development', () => {
    process.env.NODE_ENV = 'production';
    const setProd = oauthSetCookie(OAUTH_STATE_COOKIE, 'abc');
    expect(setProd).toContain('SameSite=None');
    expect(setProd).toContain('Secure');
    expect(oauthClearCookie(OAUTH_STATE_COOKIE)).toContain('Secure');

    delete process.env.NODE_ENV;
    const setDev = oauthSetCookie(OAUTH_STATE_COOKIE, 'abc');
    expect(setDev).toContain('SameSite=Lax');
    expect(setDev).not.toContain('Secure');
  });

  it('maps session errors including non-Error values', () => {
    expect(mapError('nope')).toBeUndefined();
    expect(mapError(new Error('token_expired'))?.statusCode).toBe(401);
    expect(mapError(new Error('unauthorized'))?.statusCode).toBe(401);
    expect(mapError(new Error('profile_not_found'))?.statusCode).toBe(404);
    expect(mapError(new Error('seed_user_id_required'))?.statusCode).toBe(500);
    expect(mapError(new Error('cognito_not_configured'))?.statusCode).toBe(503);
    expect(mapError(new Error('unknown_thing'))).toBeUndefined();
    expect(pendingProfile('u1', undefined, undefined)).toMatchObject({
      email: 'u1@users.local',
      displayName: 'New user',
      needsProfileCompletion: true,
    });
  });

  it('redirects oauth login to Cognito Hosted UI with handshake cookies', async () => {
    process.env.COGNITO_CLIENT_ID = 'client';
    process.env.COGNITO_HOSTED_UI_DOMAIN = 'https://auth.example.com/';
    process.env.CLIENT_ORIGIN = 'http://localhost:4200/';

    const result = await handler(
      httpEvent('GET', '/identity/oauth/login', {
        query: { returnTo: 'http://localhost:4200/teams' },
      }),
    );
    expect(result.statusCode).toBe(302);
    expect(result.headers?.location).toContain('auth.example.com/oauth2/authorize');
    expect(result.cookies?.some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))).toBe(true);
    expect(result.cookies?.some((c) => c.startsWith(`${OAUTH_VERIFIER_COOKIE}=`))).toBe(true);
    expect(result.cookies?.some((c) => c.startsWith(`${OAUTH_RETURN_COOKIE}=`))).toBe(true);
  });

  it('oauth login with AUTH_DISABLED issues a seed session redirect', async () => {
    const seedId = randomUUID();
    seedProfile(seedId, 'seed@example.com', '1990-01-01');
    process.env.AUTH_DISABLED = 'true';
    process.env.AUTH_SEED_USER_ID = seedId;
    process.env.CLIENT_ORIGIN = 'http://localhost:4200';

    const result = await handler(httpEvent('GET', '/identity/oauth/login'));
    expect(result.statusCode).toBe(302);
    expect(result.headers?.location).toBe('http://localhost:4200/schedule');
    expect(result.cookies?.some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(true);
  });

  it('rejects unsafe or invalid returnTo values', async () => {
    process.env.COGNITO_CLIENT_ID = 'client';
    process.env.COGNITO_HOSTED_UI_DOMAIN = 'auth.example.com';
    process.env.CLIENT_ORIGIN = 'http://localhost:4200';

    const evil = await handler(
      httpEvent('GET', '/identity/oauth/login', {
        query: { returnTo: 'https://evil.example/phish' },
      }),
    );
    expect(evil.cookies?.find((c) => c.startsWith(`${OAUTH_RETURN_COOKIE}=`))).toContain(
      encodeURIComponent('http://localhost:4200/schedule'),
    );

    const bad = await handler(
      httpEvent('GET', '/identity/oauth/login', {
        query: { returnTo: 'not a url' },
      }),
    );
    expect(bad.cookies?.find((c) => c.startsWith(`${OAUTH_RETURN_COOKIE}=`))).toContain(
      encodeURIComponent('http://localhost:4200/schedule'),
    );
  });

  it('handles oauth callback success, incomplete profile, and error paths', async () => {
    process.env.COGNITO_CLIENT_ID = 'client';
    process.env.COGNITO_HOSTED_UI_DOMAIN = 'auth.example.com';
    process.env.CLIENT_ORIGIN = 'http://localhost:4200';
    const userId = randomUUID();
    seedProfile(userId, 'oauth@example.com', '1990-01-01');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id_token: fakeJwt({
          sub: userId,
          email: 'oauth@example.com',
          name: 'OAuth User',
        }),
        access_token: 'access',
        refresh_token: 'refresh-from-cognito',
        expires_in: 3600,
      }),
    });

    const ok = await handler(
      httpEvent('GET', '/identity/oauth/callback', {
        query: { code: 'code1', state: 'state1' },
        cookies: [
          `${OAUTH_STATE_COOKIE}=state1`,
          `${OAUTH_VERIFIER_COOKIE}=verifier1`,
          `${OAUTH_RETURN_COOKIE}=${encodeURIComponent('http://localhost:4200/teams')}`,
        ],
      }),
    );
    expect(ok.statusCode).toBe(302);
    expect(ok.headers?.location).toBe('http://localhost:4200/teams');
    expect(ok.cookies?.some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(true);

    const incompleteId = randomUUID();
    seedProfile(incompleteId, 'new@example.com');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id_token: fakeJwt({ sub: incompleteId, email: 'new@example.com' }),
        access_token: 'access',
        refresh_token: 'refresh-2',
      }),
    });
    const incomplete = await handler(
      httpEvent('GET', '/identity/oauth/callback', {
        query: { code: 'c', state: 's' },
        cookies: [`${OAUTH_STATE_COOKIE}=s`, `${OAUTH_VERIFIER_COOKIE}=v`],
      }),
    );
    expect(incomplete.headers?.location).toBe('http://localhost:4200/complete-profile');

    delete process.env.CLIENT_ORIGIN;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id_token: fakeJwt({ sub: userId, email: 'oauth@example.com' }),
        access_token: 'access',
        refresh_token: 'refresh-3',
      }),
    });
    const defaultOrigin = await handler(
      httpEvent('GET', '/identity/oauth/callback', {
        query: { code: 'c-origin', state: 's-origin' },
        cookies: [`${OAUTH_STATE_COOKIE}=s-origin`, `${OAUTH_VERIFIER_COOKIE}=v-origin`],
      }),
    );
    expect(defaultOrigin.headers?.location).toBe('http://localhost:4200/schedule');
    process.env.CLIENT_ORIGIN = 'http://localhost:4200';

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id_token: fakeJwt({ sub: userId }),
        access_token: 'access',
      }),
    });
    const missingRefresh = await handler(
      httpEvent('GET', '/identity/oauth/callback', {
        query: { code: 'c', state: 's' },
        cookies: [`${OAUTH_STATE_COOKIE}=s`, `${OAUTH_VERIFIER_COOKIE}=v`],
      }),
    );
    expect(missingRefresh.headers?.location).toContain('missing_refresh_token');

    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    const exchangeFail = await handler(
      httpEvent('GET', '/identity/oauth/callback', {
        query: { code: 'c', state: 's' },
        cookies: [`${OAUTH_STATE_COOKIE}=s`, `${OAUTH_VERIFIER_COOKIE}=v`],
      }),
    );
    expect(exchangeFail.headers?.location).toContain('sign_in_failed');

    const providerError = await handler(
      httpEvent('GET', '/identity/oauth/callback', {
        query: { error: 'access_denied', state: 's' },
      }),
    );
    expect(providerError.headers?.location).toContain('access_denied');

    const badState = await handler(
      httpEvent('GET', '/identity/oauth/callback', {
        query: { code: 'c', state: 'wrong' },
        cookies: [`${OAUTH_STATE_COOKIE}=expected`, `${OAUTH_VERIFIER_COOKIE}=v`],
      }),
    );
    expect(badState.headers?.location).toContain('invalid_state');
  });

  it('oauth callback with AUTH_DISABLED redirects with a seed session', async () => {
    const seedId = randomUUID();
    seedProfile(seedId, 'seed@example.com', '1990-01-01');
    process.env.AUTH_DISABLED = 'true';
    process.env.AUTH_SEED_USER_ID = seedId;
    process.env.CLIENT_ORIGIN = 'http://localhost:4200';

    const result = await handler(httpEvent('GET', '/identity/oauth/callback'));
    expect(result.statusCode).toBe(302);
    expect(result.headers?.location).toBe('http://localhost:4200/schedule');
  });

  it('oauth logout redirects to Cognito or local return when auth disabled', async () => {
    process.env.COGNITO_CLIENT_ID = 'client';
    process.env.COGNITO_HOSTED_UI_DOMAIN = 'auth.example.com';
    process.env.CLIENT_ORIGIN = 'http://localhost:4200';

    const cognitoLogout = await handler(httpEvent('GET', '/identity/oauth/logout'));
    expect(cognitoLogout.headers?.location).toContain('auth.example.com/logout');

    delete process.env.COGNITO_CLIENT_ID;
    const fallback = await handler(httpEvent('GET', '/identity/oauth/logout'));
    expect(fallback.headers?.location).toBe('http://localhost:4200/login');

    process.env.AUTH_DISABLED = 'true';
    const seedId = randomUUID();
    seedProfile(seedId, 'seed@example.com', '1990-01-01');
    process.env.AUTH_SEED_USER_ID = seedId;
    const disabled = await handler(
      httpEvent('GET', '/identity/oauth/logout', {
        query: { returnTo: 'http://localhost:4200/login' },
      }),
    );
    expect(disabled.headers?.location).toBe('http://localhost:4200/login');
  });

  it('completes a profile after Hosted UI sign-in', async () => {
    const userId = randomUUID();
    const email = `${userId}@example.com`;
    const { accessToken } = issueLocalTokens(userId, email);
    seedProfile(userId, email);

    const result = await handler(
      httpEvent('POST', '/identity/profile/complete', {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { birthday: '2012-06-01', displayName: '  Kid  ' },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toMatchObject({
      displayName: 'Kid',
      accountKind: 'minor',
      birthday: '2012-06-01',
    });

    const badBirthday = await handler(
      httpEvent('POST', '/identity/profile/complete', {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { birthday: 'not-a-date' },
      }),
    );
    expect(badBirthday.statusCode).toBe(400);

    const minorChat = await import('../../lib/minor-chat.js');
    const birthdaySpy = vi.spyOn(minorChat, 'accountKindFromBirthday').mockImplementationOnce(() => {
      throw new Error('invalid_birthday');
    });
    const mappedBirthday = await handler(
      httpEvent('POST', '/identity/profile/complete', {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { birthday: '1990-01-01' },
      }),
    );
    expect(mappedBirthday.statusCode).toBe(400);
    expect(JSON.parse(mappedBirthday.body ?? '')).toEqual({ error: 'invalid_birthday' });
    birthdaySpy.mockRestore();

    const noEmailId = randomUUID();
    const tokenNoEmail = signLocalJwt({
      sub: noEmailId,
      token_use: 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const missingEmail = await handler(
      httpEvent('POST', '/identity/profile/complete', {
        headers: { authorization: `Bearer ${tokenNoEmail}` },
        body: { birthday: '1990-01-01' },
      }),
    );
    expect(missingEmail.statusCode).toBe(400);
    expect(JSON.parse(missingEmail.body ?? '')).toEqual({ error: 'email_required' });
  });

  it('serves seed session for /me and /refresh when AUTH_DISABLED', async () => {
    const seedId = randomUUID();
    seedProfile(seedId, 'seed@example.com', '1990-01-01');
    process.env.AUTH_DISABLED = 'true';
    process.env.AUTH_SEED_USER_ID = seedId;

    const me = await handler(httpEvent('GET', '/identity/me'));
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body ?? '')).toMatchObject({ email: 'seed@example.com' });

    const refresh = await handler(
      httpEvent('POST', '/identity/refresh', {
        body: {},
        headers: { 'x-refresh-delivery': 'body' },
      }),
    );
    expect(refresh.statusCode).toBe(200);
    expect(JSON.parse(refresh.body ?? '').refreshToken).toBeTruthy();
  });

  it('returns pending profile from /me and refresh when no profile row exists', async () => {
    const userId = randomUUID();
    const { accessToken, refreshToken } = issueLocalTokens(userId, `${userId}@example.com`);

    const me = await handler(
      httpEvent('GET', '/identity/me', {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body ?? '')).toMatchObject({
      userId,
      needsProfileCompletion: true,
    });

    const refresh = await handler(
      httpEvent('POST', '/identity/refresh', {
        body: { refreshToken },
      }),
    );
    expect(refresh.statusCode).toBe(200);
    expect(JSON.parse(refresh.body ?? '').user.needsProfileCompletion).toBe(true);
  });

  it('covers logout body token and refresh missing-token paths', async () => {
    const logout = await handler(
      httpEvent('POST', '/identity/logout', {
        body: { refreshToken: 'any' },
      }),
    );
    expect(logout.statusCode).toBe(204);

    const missing = await handler(httpEvent('POST', '/identity/refresh', { body: {} }));
    expect(missing.statusCode).toBe(401);

    const meUnauthorized = await handler(httpEvent('GET', '/identity/me'));
    expect(meUnauthorized.statusCode).toBe(401);
  });

  it('covers handler routeOf branches', async () => {
    expect((await handler(httpEvent('GET', '/identity'))).statusCode).toBe(404);
    expect((await handler(httpEvent('GET', '/health'))).statusCode).toBe(200);
    expect((await handler(httpEvent('GET', 'me'))).statusCode).toBe(401);
  });

  it('uses default CLIENT_ORIGIN when env is unset for oauth redirects', async () => {
    const seedId = randomUUID();
    seedProfile(seedId, 'seed@example.com', '1990-01-01');
    delete process.env.CLIENT_ORIGIN;
    process.env.AUTH_DISABLED = 'true';
    process.env.AUTH_SEED_USER_ID = seedId;

    const start = await handler(httpEvent('GET', '/identity/oauth/login'));
    expect(start.statusCode).toBe(302);
    expect(start.headers?.location).toBe('http://localhost:4200/schedule');

    delete process.env.AUTH_DISABLED;
    delete process.env.AUTH_SEED_USER_ID;
    const logout = await handler(httpEvent('GET', '/identity/oauth/logout'));
    expect(logout.headers?.location).toBe('http://localhost:4200/login');
    process.env.CLIENT_ORIGIN = 'http://localhost:4200';
  });

  it('returns profile_not_found for profile updates without a stored row', async () => {
    const userId = randomUUID();
    const { accessToken } = issueLocalTokens(userId, `${userId}@example.com`);
    const result = await handler(
      httpEvent('PATCH', '/identity/profile', {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { photoKey: null },
      }),
    );
    expect(result.statusCode).toBe(404);
  });
});
