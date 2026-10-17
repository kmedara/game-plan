/**
 * Selects the Cognito or local identity provider from the process environment.
 */

import { isCognitoConfigured, isLocalAuthEnabled } from './cognito.js';
import { createCognitoIdentityProvider } from './cognito-provider.js';
import type { IdentityProvider } from './identity-provider.js';
import { createLocalIdentityProvider } from './local-provider.js';

/** Cached provider for warm Lambda invocations and local processes. */
let provider: IdentityProvider | undefined;

/**
 * Returns the identity provider for this process.
 *
 * Cognito is used when pool and client ids are set. The local DynamoDB-backed
 * provider issues HS256 JWTs only when `AUTH_PROVIDER=local` is set outside production.
 *
 * @returns The active {@link IdentityProvider}.
 * @throws When neither Cognito nor local auth is configured.
 */
export const getIdentityProvider = (): IdentityProvider => {
  if (provider !== undefined) return provider;
  if (isCognitoConfigured()) {
    provider = createCognitoIdentityProvider();
  } else if (isLocalAuthEnabled()) {
    provider = createLocalIdentityProvider();
  } else {
    throw new Error('cognito_not_configured');
  }
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
