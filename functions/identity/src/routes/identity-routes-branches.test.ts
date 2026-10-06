/**
 * Identity route branch coverage not covered by handler integration tests.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens, signLocalJwt } from '../../../lib/auth/local-jwt.js';
import { handleMe } from './me.js';
import { mapError } from './session.js';

const profiles = new Map<string, Record<string, unknown>>();

vi.mock('../../../lib/auth/profile.js', () => ({
  getProfile: async (userId: string) => profiles.get(userId),
  putProfile: async (input: Record<string, unknown>) => {
    profiles.set(String(input.userId), input);
    return input;
  },
  findProfileByEmail: async () => undefined,
  toUserProfile: (item: Record<string, unknown>) => item,
}));

vi.mock('../../../lib/auth/provider.js', () => ({
  getIdentityProvider: () => ({
    async login() {
      return {
        userId: 'login-user',
        email: 'login@example.com',
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 3600,
      };
    },
    async register() {
      const userId = 'reg-user';
      profiles.set(userId, {
        userId,
        email: 'reg@example.com',
        displayName: 'Existing',
        accountKind: 'adult',
      });
      return {
        userId,
        email: 'reg@example.com',
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 3600,
      };
    },
  }),
  resetIdentityProvider: () => undefined,
  setIdentityProvider: () => undefined,
}));

const { handler } = await import('../handler.js');

const httpEvent = (
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.headers ?? {},
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

describe('identity route branches', () => {
  beforeEach(() => {
    profiles.clear();
    process.env.LOCAL_JWT_SECRET = 'identity-routes-branches';
  });

  afterEach(() => {
    profiles.clear();
  });

  it('returns profile_not_found when login tokens exist without a profile row', async () => {
    const result = await handler(
      httpEvent('POST', '/identity/login', {
        body: { email: 'login@example.com', password: 'Password1' },
      }),
    );
    expect(result.statusCode).toBe(404);
  });

  it('reuses an existing profile row during register', async () => {
    const result = await handler(
      httpEvent('POST', '/identity/register', {
        body: {
          email: 'reg@example.com',
          password: 'Password1',
          displayName: 'New Name',
          birthday: '1990-01-01',
        },
      }),
    );
    expect(result.statusCode).toBe(201);
  });

  it('maps unauthorized errors to the unauthorized code', () => {
    expect(mapError(new Error('unauthorized'))?.statusCode).toBe(401);
    expect(JSON.parse(mapError(new Error('unauthorized'))?.body ?? '{}')).toEqual({
      error: 'unauthorized',
    });
    expect(mapError(new Error('invalid_token'))?.statusCode).toBe(401);
    expect(JSON.parse(mapError(new Error('invalid_token'))?.body ?? '{}')).toEqual({
      error: 'invalid_token',
    });
  });

  it('completes a profile using an existing row when the token omits email', async () => {
    const userId = randomUUID();
    profiles.set(userId, {
      userId,
      email: 'stored@example.com',
      displayName: 'Stored Name',
      accountKind: 'adult',
    });
    const token = signLocalJwt({
      sub: userId,
      token_use: 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await handler(
      httpEvent('POST', '/identity/profile/complete', {
        headers: { authorization: `Bearer ${token}` },
        body: { birthday: '1990-05-15' },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toMatchObject({
      email: 'stored@example.com',
      displayName: 'Stored Name',
    });
  });

  it('uses the Player fallback when email local-part is empty', async () => {
    const userId = randomUUID();
    const token = signLocalJwt({
      sub: userId,
      email: '@provider.example',
      token_use: 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await handler(
      httpEvent('POST', '/identity/profile/complete', {
        headers: { authorization: `Bearer ${token}` },
        body: { birthday: '1990-05-15' },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toMatchObject({
      displayName: 'Player',
    });
  });

  it('completes a profile using token email and display name fallbacks', async () => {
    const userId = randomUUID();
    const token = signLocalJwt({
      sub: userId,
      email: 'complete@example.com',
      token_use: 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await handler(
      httpEvent('POST', '/identity/profile/complete', {
        headers: { authorization: `Bearer ${token}` },
        body: { birthday: '1990-05-15' },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toMatchObject({
      email: 'complete@example.com',
      displayName: 'complete',
    });
  });

  it('returns unauthorized when /me hits an unmapped auth error', async () => {
    const auth = await import('../../../lib/auth/index.js');
    const spy = vi.spyOn(auth, 'verifyAuthHeader').mockRejectedValueOnce(new Error('unexpected'));
    const result = await handleMe(
      httpEvent('GET', '/identity/me', { headers: { authorization: 'Bearer x' } }),
    );
    expect(result.statusCode).toBe(401);
    spy.mockRestore();
  });

  it('normalizes route paths with only slashes and missing rawPath', async () => {
    expect(
      (
        await handler({
          version: '2.0',
          requestContext: { http: { method: 'GET', path: '///' } },
        } as APIGatewayProxyEventV2)
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await handler({
          version: '2.0',
          requestContext: { http: { method: 'GET', path: '/identity/me' } },
        } as APIGatewayProxyEventV2)
      ).statusCode,
    ).toBe(404);
    expect((await handler(httpEvent('POST', 'refresh'))).statusCode).toBe(401);
    expect((await handler(httpEvent('POST', '/login'))).statusCode).toBeGreaterThanOrEqual(400);
  });
});
