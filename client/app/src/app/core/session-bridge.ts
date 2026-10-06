/**
 * Inlined session helpers so the Angular bundler does not need the workspace
 * package's `.js` import extensions.
 *
 * Mirrors `@gameplan/client-session` for website cookie and Capacitor
 * Preferences refresh delivery. Profile/session wire types come from
 * `@gameplan/types`.
 */

import type {
  AccountKind,
  LoginBody,
  RegisterBody,
  SessionTokens,
  UserProfile,
} from '@gameplan/types';

export type { AccountKind, SessionTokens, UserProfile };

/** How the client expects to receive and replay the refresh token. */
export type SessionMode = 'web' | 'native';

/** Async store for the refresh token on native clients. */
export type RefreshStore = {
  get: () => Promise<string | null>;
  set: (token: string) => Promise<void>;
  clear: () => Promise<void>;
};

/** Minimal Preferences surface from `@capacitor/preferences`. */
export type PreferencesLike = {
  get: (options: { key: string }) => Promise<{ value: string | null }>;
  set: (options: { key: string; value: string }) => Promise<void>;
  remove: (options: { key: string }) => Promise<void>;
};

/** Preferences key used by the Capacitor refresh store. */
export const CAPACITOR_REFRESH_KEY = 'ts_refresh';

/** Website refresh store (HttpOnly cookie holds the token). */
export class WebRefreshStore implements RefreshStore {
  async get(): Promise<string | null> {
    return null;
  }
  async set(_token: string): Promise<void> {}
  async clear(): Promise<void> {}
}

/** Capacitor refresh store backed by Preferences. */
export class CapacitorRefreshStore implements RefreshStore {
  constructor(
    private readonly preferences: PreferencesLike,
    private readonly key = CAPACITOR_REFRESH_KEY,
  ) {}

  async get(): Promise<string | null> {
    const result = await this.preferences.get({ key: this.key });
    return result.value;
  }

  async set(token: string): Promise<void> {
    await this.preferences.set({ key: this.key, value: token });
  }

  async clear(): Promise<void> {
    await this.preferences.remove({ key: this.key });
  }
}

/** Configuration for {@link SessionService}. */
export type SessionServiceOptions = {
  baseUrl: string;
  refreshStore: RefreshStore;
  mode: SessionMode;
  fetch?: typeof fetch;
};

/**
 * In-memory access-token session that talks to the identity Lambda.
 */
export class SessionService {
  private accessToken: string | undefined;
  private user: UserProfile | undefined;
  private readonly baseUrl: string;
  private readonly refreshStore: RefreshStore;
  private readonly mode: SessionMode;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SessionServiceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.refreshStore = options.refreshStore;
    this.mode = options.mode;
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis);
  }

  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  getUser(): UserProfile | undefined {
    return this.user;
  }

  /**
   * Replaces the cached profile after profile-complete without rotating tokens.
   *
   * @param user - The updated profile from identity.
   */
  setUser(user: UserProfile): void {
    this.user = user;
  }

  isAuthenticated(): boolean {
    return this.accessToken !== undefined;
  }

  async register(body: RegisterBody): Promise<SessionTokens> {
    return this.authenticate('register', body);
  }

  async login(body: LoginBody): Promise<SessionTokens> {
    return this.authenticate('login', body);
  }

  async refresh(): Promise<SessionTokens> {
    const refreshToken =
      this.mode === 'native' ? ((await this.refreshStore.get()) ?? undefined) : undefined;
    if (this.mode === 'native' && (refreshToken === undefined || refreshToken.length === 0)) {
      throw new Error('invalid_token');
    }

    const response = await this.fetchImpl(`${this.baseUrl}/refresh`, {
      method: 'POST',
      credentials: this.mode === 'web' ? 'include' : 'omit',
      headers: this.headers(),
      body: JSON.stringify(refreshToken !== undefined ? { refreshToken } : {}),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const tokens = (await response.json()) as SessionTokens;
    await this.applySession(tokens);
    return tokens;
  }

  async logout(): Promise<void> {
    const refreshToken =
      this.mode === 'native' ? ((await this.refreshStore.get()) ?? undefined) : undefined;
    try {
      await this.fetchImpl(`${this.baseUrl}/logout`, {
        method: 'POST',
        credentials: this.mode === 'web' ? 'include' : 'omit',
        headers: this.headers(),
        body: JSON.stringify(refreshToken !== undefined ? { refreshToken } : {}),
      });
    } finally {
      this.accessToken = undefined;
      this.user = undefined;
      await this.refreshStore.clear();
    }
  }

  authorizationHeader(): string | undefined {
    return this.accessToken === undefined ? undefined : `Bearer ${this.accessToken}`;
  }

  private headers(accessToken?: string): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (accessToken !== undefined) headers['authorization'] = `Bearer ${accessToken}`;
    if (this.mode === 'native') headers['x-refresh-delivery'] = 'body';
    return headers;
  }

  private async authenticate(
    path: 'register' | 'login',
    body: unknown,
  ): Promise<SessionTokens> {
    const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      method: 'POST',
      credentials: this.mode === 'web' ? 'include' : 'omit',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const tokens = (await response.json()) as SessionTokens;
    await this.applySession(tokens);
    return tokens;
  }

  private async applySession(tokens: SessionTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.user = tokens.user;
    if (this.mode === 'native') {
      if (tokens.refreshToken === undefined) throw new Error('missing_refresh_token');
      await this.refreshStore.set(tokens.refreshToken);
    }
  }
}
