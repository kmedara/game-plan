/**
 * Selects the Cognito or local identity provider from the process environment.
 */

import { isCognitoConfigured } from './cognito.js';
import { createCognitoIdentityProvider } from './cognito-provider.js';
import type { IdentityProvider } from './identity-provider.js';
import { createLocalIdentityProvider } from './local-provider.js';

/** Cached provider for warm Lambda invocations and local processes. */
let provider: IdentityProvider | undefined;

/**
 * Returns the identity provider for this process.
 *
 * Cognito is used when pool and client ids are set; otherwise the local
 * DynamoDB-backed provider issues HS256 JWTs for laptop development.
 *
 * @returns The active {@link IdentityProvider}.
 */
export const getIdentityProvider = (): IdentityProvider => {
  if (provider !== undefined) return provider;
  provider = isCognitoConfigured()
    ? createCognitoIdentityProvider()
    : createLocalIdentityProvider();
  return provider;
};

/**
 * Replaces the cached provider. Used by tests.
 *
 * @param next - The provider to use for subsequent calls.
 */
export const setIdentityProvider = (next: IdentityProvider): void => {
  provider = next;
};

/**
 * Clears the cached provider. Used by tests that change Cognito env vars.
 */
export const resetIdentityProvider = (): void => {
  provider = undefined;
};
