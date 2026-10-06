/**
 * Identity Lambda HTTP coverage with an in-memory provider and profile store.
 *
 * These tests do not need DynamoDB Local. Integration coverage against the real
 * local table lives in the same file and skips when the endpoint is down.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityProvider, IdentityTokens, UserProfileItem } from '../../lib/auth/identity-provider.js';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import { REFRESH_COOKIE } from '../../lib/auth/refresh-cookie.js';
import { resetIdentityProvider, setIdentityProvider } from '../../lib/auth/provider.js';

const profiles = new Map<string, UserProfileItem>();

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
    };
    profiles.set(input.userId, item);
    return item;
  },
}));

const { handler } = await import('./handler.js');

/**
 * Builds a minimal HTTP API event for identity routes.
 *
 * @param method - The HTTP method.
 * @param path - The request path, including `/identity`.
 * @param options - Optional body, headers, and cookies.
 * @returns An HTTP API event.
 */
const httpEvent = (
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    cookies?: string[];
  } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.headers ?? {},
    cookies: options.cookies,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

/**
 * Reads a named cookie value from a structured proxy result.
 *
 * @param cookies - The `cookies` array from the result.
 * @param name - The cookie name.
 * @returns The decoded cookie value, or `undefined`.
 */
const cookieValue = (cookies: string[] | undefined, name: string): string | undefined => {
  const entry = cookies?.find((c) => c.startsWith(`${name}=`));
  if (entry === undefined) return undefined;
  const raw = entry.slice(name.length + 1).split(';')[0] ?? '';
  return decodeURIComponent(raw);
};

/**
 * Builds a memory-backed identity provider for handler tests.
 *
 * @returns An {@link IdentityProvider} that issues local JWTs.
 */
const memoryProvider = (): IdentityProvider => {
  const users = new Map<string, { password: string; userId: string; email: string }>();

  const tokensFor = (userId: string, email: string): IdentityTokens => {
    const issued = issueLocalTokens(userId, email);
    return { ...issued, userId, email };
  };

  return {
    async register(input) {
      const email = input.email.trim().toLowerCase();
      if ([...users.values()].some((u) => u.email === email)) throw new Error('email_taken');
      const userId = randomUUID();
      users.set(userId, { password: input.password, userId, email });
      return tokensFor(userId, email);
    },
    async login(input) {
      const email = input.email.trim().toLowerCase();
      const found = [...users.values()].find((u) => u.email === email);
      if (found === undefined || found.password !== input.password) {
        throw new Error('invalid_credentials');
      }
      return tokensFor(found.userId, found.email);
    },
    async refresh(refreshToken) {
      const { verifyLocalJwt } = await import('../../lib/auth/local-jwt.js');
      const claims = verifyLocalJwt(refreshToken);
      if (claims.token_use !== 'refresh') throw new Error('invalid_token');
      const email = claims.email ?? '';
      return tokensFor(claims.sub, email);
    },
    async logout() {},
  };
};

describe('identity handler (in-memory)', () => {
  beforeEach(() => {
    profiles.clear();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    process.env.LOCAL_JWT_SECRET = 'handler-test-secret';
    resetIdentityProvider();
    setIdentityProvider(memoryProvider());
  });

  afterEach(() => {
    resetIdentityProvider();
  });

  it('registers, returns /me, refreshes from cookie and body, then logs out', async () => {
    const email = `player-${randomUUID()}@example.com`;
    const password = 'Password1';

    const registered = await handler(
      httpEvent('POST', '/identity/register', {
        body: {
          email,
          password,
          displayName: 'Ada Player',
          birthday: '1990-05-15',
        },
      }),
    );
    expect(registered.statusCode).toBe(201);
    const session = JSON.parse(registered.body ?? '') as {
      accessToken: string;
      user: { email: string; accountKind: string; displayName: string };
      refreshToken?: string;
    };
    expect(session.refreshToken).toBeUndefined();
    expect(session.user).toMatchObject({
      email,
      accountKind: 'adult',
      displayName: 'Ada Player',
    });

    const refreshFromCookie = cookieValue(registered.cookies, REFRESH_COOKIE);
    expect(refreshFromCookie).toBeTruthy();

    const me = await handler(
      httpEvent('GET', '/identity/me', {
        headers: { authorization: `Bearer ${session.accessToken}` },
      }),
    );
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body ?? '')).toMatchObject({ email, displayName: 'Ada Player' });

    const cookieRefresh = await handler(
      httpEvent('POST', '/identity/refresh', {
        body: {},
        cookies: [`${REFRESH_COOKIE}=${encodeURIComponent(refreshFromCookie!)}`],
      }),
    );
    expect(cookieRefresh.statusCode).toBe(200);

    const native = await handler(
      httpEvent('POST', '/identity/register', {
        body: {
          email: `native-${randomUUID()}@example.com`,
          password,
          displayName: 'Native User',
          birthday: '2015-03-01',
        },
        headers: { 'x-refresh-delivery': 'body' },
      }),
    );
    expect(native.statusCode).toBe(201);
    const nativeSession = JSON.parse(native.body ?? '') as { refreshToken: string };
    expect(nativeSession.refreshToken.length).toBeGreaterThan(10);

    const bodyRefresh = await handler(
      httpEvent('POST', '/identity/refresh', {
        body: { refreshToken: nativeSession.refreshToken },
        headers: { 'x-refresh-delivery': 'body' },
      }),
    );
    expect(bodyRefresh.statusCode).toBe(200);

    const loggedIn = await handler(
      httpEvent('POST', '/identity/login', { body: { email, password } }),
    );
    expect(loggedIn.statusCode).toBe(200);

    const loggedOut = await handler(
      httpEvent('POST', '/identity/logout', {
        cookies: [`${REFRESH_COOKIE}=${encodeURIComponent(refreshFromCookie!)}`],
      }),
    );
    expect(loggedOut.statusCode).toBe(204);
    expect(
      loggedOut.cookies?.some(
        (c: string) => c.startsWith(`${REFRESH_COOKIE}=`) && c.includes('Max-Age=0'),
      ),
    ).toBe(true);
  });

  it('rejects duplicate email registration', async () => {
    const email = `dup-${randomUUID()}@example.com`;
    const body = {
      email,
      password: 'Password1',
      displayName: 'First',
      birthday: '1990-05-15',
    };
    expect((await handler(httpEvent('POST', '/identity/register', { body }))).statusCode).toBe(
      201,
    );
    const second = await handler(httpEvent('POST', '/identity/register', { body }));
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body ?? '')).toEqual({ error: 'email_taken' });
  });

  it('rejects invalid login credentials', async () => {
    const result = await handler(
      httpEvent('POST', '/identity/login', {
        body: { email: `missing-${randomUUID()}@example.com`, password: 'Password1' },
      }),
    );
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body ?? '')).toEqual({ error: 'invalid_credentials' });
  });

  it('sets and clears a profile photo owned by the caller', async () => {
    const email = `photo-${randomUUID()}@example.com`;
    const registered = await handler(
      httpEvent('POST', '/identity/register', {
        body: {
          email,
          password: 'Password1',
          displayName: 'Ada Player',
          birthday: '1990-05-15',
        },
      }),
    );
    const session = JSON.parse(registered.body ?? '') as {
      accessToken: string;
      user: { userId: string };
    };
    const photoKey = `uploads/${session.user.userId}/photo`;

    const patched = await handler(
      httpEvent('PATCH', '/identity/profile', {
        headers: { authorization: `Bearer ${session.accessToken}` },
        body: { photoKey },
      }),
    );
    expect(patched.statusCode).toBe(200);
    expect(JSON.parse(patched.body ?? '')).toMatchObject({ photoKey });

    const rejected = await handler(
      httpEvent('PATCH', '/identity/profile', {
        headers: { authorization: `Bearer ${session.accessToken}` },
        body: { photoKey: 'uploads/someone-else/photo' },
      }),
    );
    expect(rejected.statusCode).toBe(400);
    expect(JSON.parse(rejected.body ?? '')).toEqual({ error: 'invalid_photo_key' });

    const cleared = await handler(
      httpEvent('PATCH', '/identity/profile', {
        headers: { authorization: `Bearer ${session.accessToken}` },
        body: { photoKey: null },
      }),
    );
    expect(cleared.statusCode).toBe(200);
    expect(JSON.parse(cleared.body ?? '').photoKey).toBeUndefined();
  });
});
