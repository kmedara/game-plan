/**
 * HttpOnly refresh-token cookie for the website session.
 *
 * The Capacitor app stores the refresh token in secure storage instead and asks
 * for body delivery via the `x-refresh-delivery: body` header.
 */

/** Cookie name written by identity register, login, and refresh. */
export const REFRESH_COOKIE = 'ts_refresh';

/** Header that asks identity to also return the refresh token in JSON. */
export const REFRESH_DELIVERY_HEADER = 'x-refresh-delivery';

/**
 * Returns whether the client wants the refresh token in the JSON body.
 *
 * @param headerValue - The `x-refresh-delivery` header value, if any.
 * @returns `true` when the client asked for body delivery (Capacitor).
 */
export const wantsBodyRefreshToken = (headerValue?: string): boolean =>
  headerValue?.trim().toLowerCase() === 'body';

/**
 * Builds the `Set-Cookie` value that stores the refresh token.
 *
 * @param refreshToken - The Cognito or local refresh token.
 * @returns A full cookie attribute string for the HTTP API `cookies` array.
 */
export const refreshSetCookie = (refreshToken: string): string => {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [
    `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}`,
    'Path=/identity',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${60 * 60 * 24 * 30}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};

/**
 * Builds the `Set-Cookie` value that clears the refresh cookie.
 *
 * @returns A full cookie attribute string that expires the cookie immediately.
 */
export const clearRefreshSetCookie = (): string => {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [
    `${REFRESH_COOKIE}=`,
    'Path=/identity',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
};
