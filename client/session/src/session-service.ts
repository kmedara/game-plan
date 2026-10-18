/**
 * Session client for the identity Lambda.
 *
 * Holds the access token in memory. Website sessions refresh via the HttpOnly
 * cookie (`credentials: 'include'`). Expo sessions store the refresh token in
 * secure storage and send it in the refresh body.
 */

import { withContentHash } from './content-hash.js';
import type { RefreshStore } from './refresh-store.js';
import type {
  AccountKind,
  LoginBody,
  RegisterBody,
  SessionTokens,
  UserProfile,
} from '@gameplan/types';

export type { AccountKind, LoginBody, RegisterBody, SessionTokens, UserProfile };

/**
 * Refresh the access token when a product request would use one with this
 * little lifetime left. Five minutes covers a slow identity call and clock skew
 * on a one-hour Cognito token.
 */
export const ACCESS_REFRESH_LEEWAY_MS = 5 * 60 * 1000;

/** How the client expects to receive and replay the refresh token. */
export type SessionMode = 'web' | 'native';

/** Configuration for {@link SessionService}. */
export type SessionServiceOptions = {
  /** Base URL of the identity API, e.g. `http://127.0.0.1:3000/identity`. */
  baseUrl: string;
  /** Refresh-token store (web no-op or the Expo secure store). */
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
  /** Epoch ms when {@link accessToken} expires. Absent until a session is applied. */
  private accessExpiresAt: number | undefined;
  private user: UserProfile | undefined;
  /** Shared by overlapping refresh() calls so a 401 stampede hits identity once. */
  private refreshInFlight: Promise<SessionTokens> | undefined;
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
    this.fetchImpl = withContentHash(options.fetch ?? fetch.bind(globalThis));
  }

  /** Returns the in-memory access token, if any. */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /** Returns the cached profile from the last successful auth call. */
  getUser(): UserProfile | undefined {
    return this.user;
  }

  /**
   * Replaces the cached profile after profile updates without rotating tokens.
   *
   * @param user - The updated profile from identity.
   */
  setUser(user: UserProfile): void {
    this.user = user;
  }

  /** Returns whether an access token is currently held. */
  isAuthenticated(): boolean {
    return this.accessToken !== undefined;
  }

  /**
   * Returns whether the next product request should refresh first.
   *
   * True when an access token is held and it expires within
   * {@link ACCESS_REFRESH_LEEWAY_MS}. Missing expiry is treated as not due, so
   * a bad payload cannot force a refresh on every call.
   *
   * @returns `true` when {@link refresh} should run before the next API call.
   */
  needsAccessRefresh(): boolean {
    if (this.accessToken === undefined || this.accessExpiresAt === undefined) return false;
    return this.accessExpiresAt - Date.now() <= ACCESS_REFRESH_LEEWAY_MS;
  }

  /**
   * Registers a new account and stores the session.
   *
   * @param body - Registration fields.
   * @returns The session tokens and profile.
   */
  async register(body: RegisterBody): Promise<SessionTokens> {
    const response = await this.fetchImpl(`${this.baseUrl}/register`, {
      method: 'POST',
      credentials: this.mode === 'web' ? 'include' : 'omit',
      headers: identityHeaders(undefined, this.mode),
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwHttpError(response);
    const payload = (await response.json()) as SessionTokens & { confirmationRequired?: boolean };
    if (payload.confirmationRequired === true) {
      throw new Error('email_confirmation_required');
    }
    await this.applySession(payload);
    return payload;
  }

  /**
   * Submits the emailed Cognito confirmation code.
   *
   * @param email - The address used at registration.
   * @param code - The code from the email.
   */
  async confirmRegistration(email: string, code: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/confirm`, {
      method: 'POST',
      credentials: this.mode === 'web' ? 'include' : 'omit',
      headers: identityHeaders(undefined, this.mode),
      body: JSON.stringify({ email, code }),
    });
    if (!response.ok) await throwHttpError(response);
  }

  /**
   * Asks Cognito to email another confirmation code.
   *
   * @param email - The address used at registration.
   */
  async resendConfirmation(email: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/confirm/resend`, {
      method: 'POST',
      credentials: this.mode === 'web' ? 'include' : 'omit',
      headers: identityHeaders(undefined, this.mode),
      body: JSON.stringify({ email }),
    });
    if (!response.ok) await throwHttpError(response);
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
   * Overlapping callers share one request. A finished attempt, success or
   * failure, leaves the next call free to try again.
   *
   * @returns The new session tokens and profile.
   */
  async refresh(): Promise<SessionTokens> {
    if (this.refreshInFlight !== undefined) return this.refreshInFlight;
    this.refreshInFlight = this.refreshOnce().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  /**
   * Performs one refresh against identity.
   *
   * @returns The new session tokens and profile.
   */
  private async refreshOnce(): Promise<SessionTokens> {
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
      this.accessExpiresAt = undefined;
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
   * Stores tokens returned outside login/refresh, such as a native OAuth exchange.
   *
   * @param tokens - The session payload from identity.
   */
  async adopt(tokens: SessionTokens): Promise<void> {
    await this.applySession(tokens);
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
    this.accessExpiresAt =
      typeof tokens.expiresIn === 'number' && tokens.expiresIn > 0
        ? Date.now() + tokens.expiresIn * 1000
        : undefined;
    this.user = tokens.user;
    if (this.mode === 'native') {
      if (tokens.refreshToken === undefined) throw new Error('missing_refresh_token');
      await this.refreshStore.set(tokens.refreshToken);
    }
  }
}
