/**
 * HttpOnly refresh-token cookie for the website session.
 *
 * The Expo app stores the refresh token in secure storage instead and asks
 * for body delivery via the `x-refresh-delivery: body` header.
 */

/** Cookie name written by identity register, login, and refresh. */
export const REFRESH_COOKIE = 'ts_refresh';

/**
 * Cookie path for session cookies on the website host.
 *
 * CloudFront serves the HTTP API under `/api`, so the browser calls
 * `/api/identity/...` on the site origin.
 */
export const SESSION_COOKIE_PATH = '/api/identity';

/** Previous cookie path. Responses expire it so browsers drop the old cookie. */
const LEGACY_SESSION_COOKIE_PATH = '/identity';

/**
 * Cookie that carries the website access token.
 *
 * The website never sees the access JWT: identity sets it here and
 * `authorizationOf` in `functions/lib/http.ts` reads it when no
 * `Authorization` header is sent.
 */
export const ACCESS_COOKIE = 'ts_access';

/** Every area is under `/api`, so the access cookie goes to all of them. */
export const ACCESS_COOKIE_PATH = '/api';

/** Header that asks identity to also return the refresh token in JSON. */
export const REFRESH_DELIVERY_HEADER = 'x-refresh-delivery';

/**
 * Returns whether the client wants the refresh token in the JSON body.
 *
 * @param headerValue - The `x-refresh-delivery` header value, if any.
 * @returns `true` when the client asked for body delivery (the Expo app).
 */
export const wantsBodyRefreshToken = (headerValue?: string): boolean =>
  headerValue?.trim().toLowerCase() === 'body';

/**
 * Builds one `Set-Cookie` attribute string.
 *
 * The website and the API share an origin, so `SameSite=Lax` is sent on
 * same-site requests. Production adds `Secure`.
 *
 * @param assignment - `name=value`, already encoded.
 * @param path - Cookie path.
 * @param maxAge - Lifetime in seconds. Zero expires the cookie.
 * @param sameSite - `Lax` by default; the access cookie uses `Strict`.
 * @returns A full cookie attribute string.
 */
const sessionCookie = (
  assignment: string,
  path: string,
  maxAge: number,
  sameSite: 'Lax' | 'Strict' = 'Lax',
): string => {
  const parts = [assignment, `Path=${path}`, 'HttpOnly', `SameSite=${sameSite}`, `Max-Age=${maxAge}`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
};

/**
 * Builds the live session cookie and expires the previous path.
 *
 * @param name - Cookie name.
 * @param value - Cookie value, already encoded. Blank expires the live cookie.
 * @param maxAge - Lifetime in seconds for the live path.
 * @returns The live cookie, then an expired cookie on the old path.
 */
export const sessionCookies = (name: string, value: string, maxAge: number): string[] => [
  sessionCookie(`${name}=${value}`, SESSION_COOKIE_PATH, maxAge),
  sessionCookie(`${name}=`, LEGACY_SESSION_COOKIE_PATH, 0),
];

/**
 * Builds the `Set-Cookie` values that store the refresh token.
 *
 * @param refreshToken - The Cognito or local refresh token.
 * @returns The live cookie and an expired cookie on the old path.
 */
export const refreshSetCookie = (refreshToken: string): string[] =>
  sessionCookies(REFRESH_COOKIE, encodeURIComponent(refreshToken), 60 * 60 * 24 * 30);

/**
 * Builds the `Set-Cookie` values that clear the refresh cookie.
 *
 * @returns Expired cookies for the live path and the old path.
 */
export const clearRefreshSetCookie = (): string[] => sessionCookies(REFRESH_COOKIE, '', 0);

/**
 * Builds the `Set-Cookie` value that stores the website access token.
 *
 * `SameSite=Strict` keeps the cookie off every cross-site request, including
 * top-level navigations, so another site cannot make an authenticated call.
 *
 * @param accessToken - The Cognito or local access JWT.
 * @param maxAge - Lifetime in seconds, the token's own `expiresIn`.
 * @returns The cookie attribute string.
 */
export const accessSetCookie = (accessToken: string, maxAge: number): string =>
  sessionCookie(`${ACCESS_COOKIE}=${encodeURIComponent(accessToken)}`, ACCESS_COOKIE_PATH, maxAge, 'Strict');

/**
 * Builds the `Set-Cookie` value that clears the access cookie.
 *
 * @returns An expired access cookie.
 */
export const clearAccessSetCookie = (): string =>
  sessionCookie(`${ACCESS_COOKIE}=`, ACCESS_COOKIE_PATH, 0, 'Strict');
