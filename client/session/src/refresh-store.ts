/**
 * Refresh-token storage adapters for website and Capacitor sessions.
 *
 * The website never reads the refresh token in JavaScript — identity sets an
 * HttpOnly cookie. Capacitor stores the refresh token in secure preferences
 * and sends it in the refresh body.
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
 * Minimal Preferences surface from `@capacitor/preferences`.
 *
 * Injected so this package does not hard-depend on Capacitor until the native
 * projects exist.
 */
export type PreferencesLike = {
  get: (options: { key: string }) => Promise<{ value: string | null }>;
  set: (options: { key: string; value: string }) => Promise<void>;
  remove: (options: { key: string }) => Promise<void>;
};

/** Preferences key used by the Capacitor refresh store. */
export const CAPACITOR_REFRESH_KEY = 'ts_refresh';

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

/**
 * Capacitor refresh store backed by Preferences (secure storage on device).
 */
export class CapacitorRefreshStore implements RefreshStore {
  /**
   * @param preferences - The Capacitor Preferences plugin (or a test double).
   * @param key - Storage key. Defaults to {@link CAPACITOR_REFRESH_KEY}.
   */
  constructor(
    private readonly preferences: PreferencesLike,
    private readonly key = CAPACITOR_REFRESH_KEY,
  ) {}

  /** Reads the refresh token from Preferences. */
  async get(): Promise<string | null> {
    const result = await this.preferences.get({ key: this.key });
    return result.value;
  }

  /** Writes the refresh token to Preferences. */
  async set(token: string): Promise<void> {
    await this.preferences.set({ key: this.key, value: token });
  }

  /** Removes the refresh token from Preferences. */
  async clear(): Promise<void> {
    await this.preferences.remove({ key: this.key });
  }
}
