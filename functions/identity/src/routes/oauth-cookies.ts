/**
 * Cookie helpers for the Hosted UI OAuth PKCE handshake.
 */

import { sessionCookies } from '../../../lib/auth/refresh-cookie.js';

/** Cookie that holds the OAuth `state` value. */
export const OAUTH_STATE_COOKIE = 'ts_oauth_state';

/** Cookie that holds the PKCE code verifier. */
export const OAUTH_VERIFIER_COOKIE = 'ts_oauth_verifier';

/** Cookie that holds the post-login return URL. */
export const OAUTH_RETURN_COOKIE = 'ts_oauth_return';

/** Cookie that marks a native app handoff (`1`) instead of a website redirect. */
export const OAUTH_NATIVE_COOKIE = 'ts_oauth_native';

/** Custom-scheme redirect the native app claims after Hosted UI. */
export const NATIVE_AUTH_REDIRECT = 'gameplan://auth';

/**
 * Builds short-lived HttpOnly cookies for the OAuth handshake.
 *
 * @param name - Cookie name.
 * @param value - Cookie value (will be URI-encoded).
 * @returns The live cookie and an expired cookie on the old path.
 */
export const oauthSetCookie = (name: string, value: string): string[] =>
  sessionCookies(name, encodeURIComponent(value), 60 * 10);

/**
 * Builds cookies that clear an OAuth handshake cookie.
 *
 * @param name - Cookie name.
 * @returns Expired cookies for the live path and the old path.
 */
export const oauthClearCookie = (name: string): string[] => sessionCookies(name, '', 0);
