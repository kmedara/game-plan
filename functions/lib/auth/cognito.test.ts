/**
 * Unit tests for local JWT helpers and Cognito/local access-token verification.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  issueLocalTokens,
  resetAccessVerifier,
  signLocalJwt,
  verifyAccessToken,
  verifyAuthHeader,
  verifyLocalJwt,
} from '../index.js';

describe('cognito auth', () => {
  afterEach(() => {
    resetAccessVerifier();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    delete process.env.LOCAL_JWT_SECRET;
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
});
