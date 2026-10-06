/**
 * Unit tests for identity provider selection and caching.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { IdentityProvider } from './identity-provider.js';
import {
  getIdentityProvider,
  resetIdentityProvider,
  setIdentityProvider,
} from './provider.js';

describe('getIdentityProvider', () => {
  afterEach(() => {
    resetIdentityProvider();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
  });

  it('returns the local provider when Cognito is not configured', () => {
    const first = getIdentityProvider();
    const second = getIdentityProvider();
    expect(first).toBe(second);
    expect(first.register).toBeTypeOf('function');
  });

  it('returns the Cognito provider when pool and client ids are set', () => {
    process.env.COGNITO_USER_POOL_ID = 'pool';
    process.env.COGNITO_CLIENT_ID = 'client';
    resetIdentityProvider();
    const provider = getIdentityProvider();
    expect(provider.logout).toBeTypeOf('function');
  });

  it('honors setIdentityProvider and resetIdentityProvider', () => {
    const stub: IdentityProvider = {
      async register() {
        throw new Error('stub-register');
      },
      async login() {
        throw new Error('stub-login');
      },
      async refresh() {
        throw new Error('stub-refresh');
      },
      async logout() {},
    };
    setIdentityProvider(stub);
    expect(getIdentityProvider()).toBe(stub);
    resetIdentityProvider();
    expect(getIdentityProvider()).not.toBe(stub);
  });
});
