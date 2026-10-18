/**
 * `POST /identity/logout`
 */

import {
  clearRefreshSetCookie,
  getIdentityProvider,
  REFRESH_COOKIE,
} from '../../../lib/auth/index.js';
import { parseJsonBody, readCookie, withCookies } from '../../../lib/http.js';
import { route } from '../../../lib/pipeline.js';

/**
 * Handles `POST /identity/logout`.
 *
 * @param event - The HTTP API event.
 * @returns A cleared-cookie response.
 */
export const handleLogout = route('POST', '/identity/logout', async ({ event }) => {
  const body = parseJsonBody(event) ?? {};
  const refreshToken =
    typeof body === 'object' &&
    body !== null &&
    'refreshToken' in body &&
    typeof (body as { refreshToken?: unknown }).refreshToken === 'string'
      ? (body as { refreshToken: string }).refreshToken
      : readCookie(event, REFRESH_COOKIE);

  try {
    await getIdentityProvider().logout(refreshToken);
  } catch {
    // Best-effort revoke.
  }

  return withCookies({ statusCode: 204 }, clearRefreshSetCookie());
});
