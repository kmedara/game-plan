/**
 * Unit tests for refresh-token cookie helpers.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  ACCESS_COOKIE,
  accessSetCookie,
  clearAccessSetCookie,
  clearRefreshSetCookie,
  REFRESH_COOKIE,
  refreshSetCookie,
  wantsBodyRefreshToken,
} from './refresh-cookie.js';

describe('refresh cookie helpers', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('detects body delivery from the refresh header', () => {
    expect(wantsBodyRefreshToken(undefined)).toBe(false);
    expect(wantsBodyRefreshToken('json')).toBe(false);
    expect(wantsBodyRefreshToken('  BoDy  ')).toBe(true);
  });

  it('sets a Lax cookie on /api/identity and expires the old path', () => {
    const set = refreshSetCookie('token value');
    expect(set).toEqual([
      `${REFRESH_COOKIE}=token%20value; Path=/api/identity; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      `${REFRESH_COOKIE}=; Path=/identity; HttpOnly; SameSite=Lax; Max-Age=0`,
    ]);

    const cleared = clearRefreshSetCookie();
    expect(cleared).toEqual([
      `${REFRESH_COOKIE}=; Path=/api/identity; HttpOnly; SameSite=Lax; Max-Age=0`,
      `${REFRESH_COOKIE}=; Path=/identity; HttpOnly; SameSite=Lax; Max-Age=0`,
    ]);
  });

  it('sets a Strict access cookie on /api for the token lifetime', () => {
    expect(accessSetCookie('a.b c', 3600)).toBe(
      `${ACCESS_COOKIE}=a.b%20c; Path=/api; HttpOnly; SameSite=Strict; Max-Age=3600`,
    );
    expect(clearAccessSetCookie()).toBe(`${ACCESS_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0`);
  });

  it('adds Secure in production', () => {
    process.env.NODE_ENV = 'production';
    const set = refreshSetCookie('prod-token');
    expect(set.every((cookie) => cookie.includes('SameSite=Lax'))).toBe(true);
    expect(set.every((cookie) => cookie.includes('Secure'))).toBe(true);

    const cleared = clearRefreshSetCookie();
    expect(cleared.every((cookie) => cookie.includes('SameSite=Lax'))).toBe(true);
    expect(cleared.every((cookie) => cookie.includes('Secure'))).toBe(true);
    expect(accessSetCookie('t', 60)).toContain('Secure');
  });
});
