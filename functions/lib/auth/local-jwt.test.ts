/**
 * Unit tests for local HS256 JWT helpers.
 */

import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  issueLocalTokens,
  localJwtSecret,
  signLocalJwt,
  verifyLocalJwt,
} from './local-jwt.js';

describe('local-jwt', () => {
  afterEach(() => {
    delete process.env.LOCAL_JWT_SECRET;
  });

  it('uses LOCAL_JWT_SECRET when configured', () => {
    process.env.LOCAL_JWT_SECRET = 'from-env';
    expect(localJwtSecret()).toBe('from-env');
  });

  it('issues and verifies access and refresh token pairs', () => {
    process.env.LOCAL_JWT_SECRET = 'pair-secret';
    const { accessToken, refreshToken, expiresIn } = issueLocalTokens('u1', 'a@example.com');
    expect(expiresIn).toBeGreaterThan(0);
    expect(verifyLocalJwt(accessToken).token_use).toBe('access');
    expect(verifyLocalJwt(refreshToken).token_use).toBe('refresh');
  });

  it('rejects malformed, expired, and invalid-use tokens', () => {
    process.env.LOCAL_JWT_SECRET = 'reject-secret';
    expect(() => verifyLocalJwt('a.b')).toThrow('invalid_token');

    const expired = signLocalJwt({
      sub: 'u1',
      token_use: 'access',
      iat: 0,
      exp: 1,
    });
    expect(() => verifyLocalJwt(expired)).toThrow('token_expired');

    const badUse = signLocalJwt({
      sub: 'u1',
      token_use: 'id' as 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(() => verifyLocalJwt(badUse)).toThrow('invalid_token');

    const noSub = signLocalJwt({
      sub: '',
      token_use: 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(() => verifyLocalJwt(noSub)).toThrow('invalid_token');

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url',
    );
    const payload = Buffer.from('not-json').toString('base64url');
    const data = `${header}.${payload}`;
    const signature = createHmac('sha256', 'reject-secret').update(data).digest('base64url');
    expect(() => verifyLocalJwt(`${data}.${signature}`)).toThrow('invalid_token');
  });

  it('rejects tokens whose segments are missing after split', () => {
    process.env.LOCAL_JWT_SECRET = 'reject-secret';
    const splitSpy = vi.spyOn(String.prototype, 'split').mockReturnValueOnce([
      'header',
      'payload',
      undefined as unknown as string,
    ]);
    expect(() => verifyLocalJwt('header.payload.sig')).toThrow('invalid_token');
    splitSpy.mockRestore();
  });
});
