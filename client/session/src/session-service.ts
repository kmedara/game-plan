/**
 * Session client for the identity Lambda.
 *
 * Holds the access token in memory. Website sessions refresh via the HttpOnly
 * cookie (`credentials: 'include'`). Capacitor sessions store the refresh token
 * in Preferences and send it in the refresh body.
 */

import type { RefreshStore } from './refresh-store.js';
import type {
  AccountKind,
  LoginBody,
  RegisterBody,
  SessionTokens,
  UserProfile,
} from '@gameplan/types';

export type { AccountKind, LoginBody, RegisterBody, SessionTokens, UserProfile };

/** How the client expects to receive and replay the refresh token. */
export type SessionMode = 'web' | 'native';

/** Configuration for {@link SessionService}. */
export type SessionServiceOptions = {
  /** Base URL of the identity API, e.g. `http://127.0.0.1:3000/identity`. */
  baseUrl: string;
  /** Refresh-token store (web no-op or Capacitor Preferences). */
  refreshStore: RefreshStore;
  /**
   * `web` uses cookies only. `native` asks for body refresh tokens and stores them.
   */
  mode: SessionMode;
  /** Optional fetch implementation (defaults to global `fetch`). */
  fetch?: typeof fetch;
};

/**
 * Builds headers for an identity request.
 *
 * @param accessToken - Optional bearer token for authenticated routes.
 * @param mode - Web or native refresh delivery.
 * @returns A headers init object.
 */
const identityHeaders = (
  accessToken: string | undefined,
  mode: SessionMode,
): Record<string, string> => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (accessToken !== undefined) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  if (mode === 'native') {
    headers['x-refresh-delivery'] = 'body';
  }
  return headers;
};

/**
 * Reads a JSON error body and throws with the `error` code when present.
 *
 * @param response - The fetch response.
 * @returns Never; always throws.
 */
const throwHttpError = async (response: Response): Promise<never> => {
  let code = `http_${response.status}`;
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === 'string') code = body.error;
  } catch {
    // Keep the status-based code.
  }
  throw new Error(code);
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

  /**
   * @param options - Base URL, refresh store, and session mode.
   */
  constructor(options: SessionServiceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.refreshStore = options.refreshStore;
    this.mode = options.mode;
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis);
  }

  /** Returns the in-memory access token, if any. */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /** Returns the cached profile from the last successful auth call. */
  getUser(): UserProfile | undefined {
    return this.user;
  }

  /** Returns whether an access token is currently held. */
  isAuthenticated(): boolean {
    return this.accessToken !== undefined;
  }

  /**
   * Registers a new account and stores the session.
   *
   * @param body - Registration fields.
   * @returns The session tokens and profile.
   */
  async register(body: RegisterBody): Promise<SessionTokens> {
    return this.authenticate('register', body);
  }

  /**
   * Logs in and stores the session.
   *
   * @param body - Email and password.
   * @returns The session tokens and profile.
   */
  async login(body: LoginBody): Promise<SessionTokens> {
    return this.authenticate('login', body);
  }

  /**
   * Refreshes the access token from the cookie (web) or Preferences (native).
   *
   * @returns The new session tokens and profile.
   */
  async refresh(): Promise<SessionTokens> {
    const refreshToken =
      this.mode === 'native' ? ((await this.refreshStore.get()) ?? undefined) : undefined;
    if (this.mode === 'native' && (refreshToken === undefined || refreshToken.length === 0)) {
      throw new Error('invalid_token');
    }

    const response = await this.fetchImpl(`${this.baseUrl}/refresh`, {
      method: 'POST',
      credentials: this.mode === 'web' ? 'include' : 'omit',
      headers: identityHeaders(undefined, this.mode),
      body: JSON.stringify(refreshToken !== undefined ? { refreshToken } : {}),
    });
    if (!response.ok) await throwHttpError(response);
    const tokens = (await response.json()) as SessionTokens;
    await this.applySession(tokens);
    return tokens;
  }

  /**
   * Clears the local session and asks identity to clear the cookie / revoke.
   */
  async logout(): Promise<void> {
    const refreshToken =
      this.mode === 'native' ? ((await this.refreshStore.get()) ?? undefined) : undefined;
    try {
      await this.fetchImpl(`${this.baseUrl}/logout`, {
        method: 'POST',
        credentials: this.mode === 'web' ? 'include' : 'omit',
        headers: identityHeaders(undefined, this.mode),
        body: JSON.stringify(refreshToken !== undefined ? { refreshToken } : {}),
      });
    } finally {
      this.accessToken = undefined;
      this.user = undefined;
      await this.refreshStore.clear();
    }
  }

  /**
   * Loads the current profile with the in-memory access token.
   *
   * @returns The profile from `GET /me`.
   */
  async me(): Promise<UserProfile> {
    if (this.accessToken === undefined) throw new Error('unauthorized');
    const response = await this.fetchImpl(`${this.baseUrl}/me`, {
      method: 'GET',
      credentials: this.mode === 'web' ? 'include' : 'omit',
      headers: identityHeaders(this.accessToken, this.mode),
    });
    if (!response.ok) await throwHttpError(response);
    const profile = (await response.json()) as UserProfile;
    this.user = profile;
    return profile;
  }

  /**
   * Authorization header value for other product API calls.
   *
   * @returns `Bearer <token>`, or `undefined` when signed out.
   */
  authorizationHeader(): string | undefined {
    return this.accessToken === undefined ? undefined : `Bearer ${this.accessToken}`;
  }

  /**
   * Posts register or login and applies the returned session.
   *
   * @param path - `register` or `login`.
   * @param body - Request JSON body.
   * @returns The session tokens.
   */
  private async authenticate(
    path: 'register' | 'login',
    body: RegisterBody | LoginBody,
  ): Promise<SessionTokens> {
    const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      method: 'POST',
      credentials: this.mode === 'web' ? 'include' : 'omit',
      headers: identityHeaders(undefined, this.mode),
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwHttpError(response);
    const tokens = (await response.json()) as SessionTokens;
    await this.applySession(tokens);
    return tokens;
  }

  /**
   * Stores the access token in memory and the refresh token when native.
   *
   * @param tokens - Tokens returned by identity.
   */
  private async applySession(tokens: SessionTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.user = tokens.user;
    if (this.mode === 'native') {
      if (tokens.refreshToken === undefined) throw new Error('missing_refresh_token');
      await this.refreshStore.set(tokens.refreshToken);
    }
  }
}
