/**
 * Refresh-token storage for website sessions.
 *
 * The website never reads the refresh token in JavaScript — identity sets an
 * HttpOnly cookie. The Expo app stores the native refresh token in its own
 * secure store and sends it in the refresh body.
 */

/** Async store for the refresh token on native clients. */
export type RefreshStore = {
  /** Reads the stored refresh token, or `null` when absent. */
  get: () => Promise<string | null>;
  /** Persists a refresh token. */
  set: (token: string) => Promise<void>;
  /** Clears the stored refresh token. */
  clear: () => Promise<void>;
};

/**
 * Website refresh store. The HttpOnly cookie holds the token; JavaScript cannot
 * read it, so get/set/clear are no-ops and refresh uses `credentials: 'include'`.
 */
export class WebRefreshStore implements RefreshStore {
  /** Always returns `null`; the cookie is not readable from script. */
  async get(): Promise<string | null> {
    return null;
  }

  /** No-op; identity already set the HttpOnly cookie. */
  async set(_token: string): Promise<void> {}

  /** No-op; logout clears the cookie on the identity response. */
  async clear(): Promise<void> {}
}
