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
    process.env.AUTH_PROVIDER = 'local';
    process.env.NODE_ENV = 'test';
  });

  it('returns the local provider when local auth is requested', () => {
    const first = getIdentityProvider();
    const second = getIdentityProvider();
    expect(first).toBe(second);
    expect(first.register).toBeTypeOf('function');
  });

  it('refuses to start without Cognito or an explicit local provider', () => {
    delete process.env.AUTH_PROVIDER;
    expect(() => getIdentityProvider()).toThrow('cognito_not_configured');
  });

  it('refuses the local provider in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getIdentityProvider()).toThrow('cognito_not_configured');
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
      async confirmRegistration() {
        throw new Error('stub-confirm');
      },
      async resendConfirmation() {
        throw new Error('stub-resend');
      },
      async refresh() {
        throw new Error('stub-refresh');
      },
      async logout() {},
      async deleteUser() {},
    };
    setIdentityProvider(stub);
    expect(getIdentityProvider()).toBe(stub);
    resetIdentityProvider();
    expect(getIdentityProvider()).not.toBe(stub);
  });
});
