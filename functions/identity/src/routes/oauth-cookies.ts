/**
 * Cookie helpers for the Hosted UI OAuth PKCE handshake.
 */

/** Cookie that holds the OAuth `state` value. */
export const OAUTH_STATE_COOKIE = 'ts_oauth_state';

/** Cookie that holds the PKCE code verifier. */
export const OAUTH_VERIFIER_COOKIE = 'ts_oauth_verifier';

/** Cookie that holds the post-login return URL. */
export const OAUTH_RETURN_COOKIE = 'ts_oauth_return';

/**
 * Builds a short-lived HttpOnly cookie for the OAuth handshake.
 *
 * @param name - Cookie name.
 * @param value - Cookie value (will be URI-encoded).
 * @returns A full `Set-Cookie` attribute string.
 */
export const oauthSetCookie = (name: string, value: string): string => {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/identity',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${60 * 10}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};

/**
 * Builds a cookie that clears an OAuth handshake cookie.
 *
 * @param name - Cookie name.
 * @returns A full `Set-Cookie` attribute string.
 */
export const oauthClearCookie = (name: string): string => {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [
    `${name}=`,
    'Path=/identity',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};
