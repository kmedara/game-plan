/**
 * Unit tests for local JWT helpers and Cognito/local access-token verification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  issueLocalTokens,
  resetAccessVerifier,
  signLocalJwt,
  verifyAccessToken,
  verifyAuthHeader,
  verifyLocalJwt,
} from '../index.js';

const mockVerify = vi.fn();

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({ verify: mockVerify }),
  },
}));

describe('cognito auth', () => {
  beforeEach(() => {
    mockVerify.mockReset();
  });

  afterEach(() => {
    resetAccessVerifier();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    delete process.env.LOCAL_JWT_SECRET;
    delete process.env.AUTH_DISABLED;
    delete process.env.AUTH_SEED_USER_ID;
  });

  it('rejects a missing Authorization header', async () => {
    await expect(verifyAuthHeader(undefined)).rejects.toThrow('unauthorized');
  });

  it('rejects a non-Bearer Authorization header', async () => {
    await expect(verifyAuthHeader('Basic abc')).rejects.toThrow('unauthorized');
  });

  it('accepts a local access token when Cognito is not configured', async () => {
    process.env.LOCAL_JWT_SECRET = 'unit-test-secret';
    const { accessToken } = issueLocalTokens('user-1', 'a@example.com');
    await expect(verifyAccessToken(accessToken)).resolves.toEqual({
      userId: 'user-1',
      email: 'a@example.com',
    });
  });

  it('reads the caller from API Gateway JWT claims without a bearer header', async () => {
    const { authenticateRequest } = await import('./cognito.js');
    const event = {
      version: '2.0',
      rawPath: '/teams',
      headers: {},
      requestContext: {
        http: { method: 'GET', path: '/teams' },
        authorizer: {
          jwt: { claims: { sub: 'user-from-gateway', email: 'g@example.com' } },
        },
      },
    };
    await expect(authenticateRequest(event as never)).resolves.toEqual({
      userId: 'user-from-gateway',
      email: 'g@example.com',
    });
  });

  it('rejects a local refresh token as an access token', async () => {
    process.env.LOCAL_JWT_SECRET = 'unit-test-secret';
    const { refreshToken } = issueLocalTokens('user-1', 'a@example.com');
    await expect(verifyAccessToken(refreshToken)).rejects.toThrow('unauthorized');
  });

  it('rejects a forged local token', async () => {
    process.env.LOCAL_JWT_SECRET = 'unit-test-secret';
    const forged = signLocalJwt({
      sub: 'user-1',
      email: 'a@example.com',
      token_use: 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    process.env.LOCAL_JWT_SECRET = 'other-secret';
    expect(() => verifyLocalJwt(forged)).toThrow('invalid_token');
  });

  it('reports Cognito configuration and maps verified payloads', async () => {
    const { getAccessVerifier, isCognitoConfigured, toAuthUser } = await import('./cognito.js');
    expect(isCognitoConfigured()).toBe(false);
    process.env.COGNITO_USER_POOL_ID = 'pool';
    process.env.COGNITO_CLIENT_ID = 'client';
    resetAccessVerifier();
    expect(isCognitoConfigured()).toBe(true);
    expect(getAccessVerifier()).toBe(getAccessVerifier());
    expect(toAuthUser({ sub: 'u1', email: 123 })).toEqual({ userId: 'u1', email: undefined });

    delete process.env.COGNITO_CLIENT_ID;
    resetAccessVerifier();
    expect(() => getAccessVerifier()).toThrow('cognito_not_configured');
  });

  it('verifies Cognito access tokens when configured', async () => {
    process.env.COGNITO_USER_POOL_ID = 'pool';
    process.env.COGNITO_CLIENT_ID = 'client';
    resetAccessVerifier();
    mockVerify.mockResolvedValueOnce({ sub: 'cognito-user', email: 'c@example.com' });
    await expect(verifyAccessToken('cognito-access')).resolves.toEqual({
      userId: 'cognito-user',
      email: 'c@example.com',
    });
  });

  it('falls back to the Authorization header when API Gateway claims are absent', async () => {
    process.env.LOCAL_JWT_SECRET = 'unit-test-secret';
    const { authenticateRequest } = await import('./cognito.js');
    const { accessToken } = issueLocalTokens('header-user', 'h@example.com');
    const event = {
      version: '2.0',
      rawPath: '/teams',
      headers: { authorization: `Bearer ${accessToken}` },
      requestContext: { http: { method: 'GET', path: '/teams' } },
    };
    await expect(authenticateRequest(event as never)).resolves.toEqual({
      userId: 'header-user',
      email: 'h@example.com',
    });
  });

  it('returns the seed user when AUTH_DISABLED is true', async () => {
    process.env.AUTH_DISABLED = 'true';
    process.env.AUTH_SEED_USER_ID = 'seed-123';
    const { authenticateRequest, verifyAccessToken, verifyAuthHeader } = await import(
      './cognito.js'
    );
    await expect(verifyAccessToken('ignored')).resolves.toEqual({ userId: 'seed-123' });
    await expect(verifyAuthHeader(undefined)).resolves.toEqual({ userId: 'seed-123' });
    await expect(
      authenticateRequest({
        version: '2.0',
        headers: {},
        requestContext: { http: { method: 'GET', path: '/' } },
      } as never),
    ).resolves.toEqual({ userId: 'seed-123' });
  });
});
