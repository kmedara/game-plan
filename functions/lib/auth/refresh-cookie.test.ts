/**
 * Unit tests for refresh-token cookie helpers.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
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

  it('sets Lax cookies in non-production', () => {
    const set = refreshSetCookie('token value');
    expect(set).toContain(`${REFRESH_COOKIE}=token%20value`);
    expect(set).toContain('SameSite=Lax');
    expect(set).not.toContain('Secure');

    const cleared = clearRefreshSetCookie();
    expect(cleared).toContain(`${REFRESH_COOKIE}=`);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).not.toContain('Secure');
  });

  it('adds Secure and SameSite=None in production', () => {
    process.env.NODE_ENV = 'production';
    const set = refreshSetCookie('prod-token');
    expect(set).toContain('SameSite=None');
    expect(set).toContain('Secure');

    const cleared = clearRefreshSetCookie();
    expect(cleared).toContain('SameSite=None');
    expect(cleared).toContain('Secure');
  });
});
