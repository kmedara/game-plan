/**
 * Typed helpers for the product HTTP API.
 */

import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type {
  ChatMessage,
  ChatSummary,
  RolePermissions,
  ScheduleOccurrence,
  TeamDirectoryHit,
  TeamSummary,
  UpdateTeamBody,
  UserProfile,
} from '@gameplan/types';
import {
  CapacitorRefreshStore,
  SessionService,
  WebRefreshStore,
} from './session-bridge';
import { environment } from '../../environments/environment';

export type {
  ChatMessage,
  ChatSummary,
  RolePermissions,
  ScheduleOccurrence,
  TeamDirectoryHit,
  TeamSummary,
};

/**
 * Session + product API client used by the Angular screens.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly native = Capacitor.isNativePlatform();
  private readonly session = new SessionService({
    baseUrl: `${environment.apiBaseUrl}/identity`,
    mode: this.native ? 'native' : 'web',
    refreshStore: this.native
      ? new CapacitorRefreshStore(Preferences)
      : new WebRefreshStore(),
  });

  private selectedTeamId: string | undefined;

  /** Whether the signed-in user belongs to at least one team (drives schedule/chat nav). */
  readonly hasTeams = signal(false);

  /** Cached profile from the last auth call. */
  get user(): UserProfile | undefined {
    return this.session.getUser();
  }

  /** Whether an access token is held in memory. */
  isAuthenticated(): boolean {
    return this.session.isAuthenticated();
  }

  /** Currently selected team id for schedule and admin screens. */
  getTeamId(): string | undefined {
    return this.selectedTeamId;
  }

  /** Selects the active team for schedule and admin screens. */
  setTeamId(teamId: string | undefined): void {
    this.selectedTeamId = teamId;
  }

  /** Bearer token for WebSocket `?token=`. */
  accessToken(): string | undefined {
    return this.session.getAccessToken();
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    birthday: string;
  }): Promise<void> {
    await this.session.register(input);
  }

  async login(input: { email: string; password: string }): Promise<void> {
    await this.session.login(input);
  }

  async completeProfile(input: { birthday: string; displayName?: string }): Promise<void> {
    const profile = await this.request<UserProfile>('POST', '/identity/profile/complete', input);
    this.session.setUser(profile);
  }

  async refreshSession(): Promise<boolean> {
    try {
      await this.session.refresh();
      return true;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    if (!environment.authDisabled) {
      const returnTo = encodeURIComponent(`${window.location.origin}/login`);
      window.location.href = `${environment.apiBaseUrl}/identity/oauth/logout?returnTo=${returnTo}`;
      return;
    }
    await this.session.logout();
    this.selectedTeamId = undefined;
    this.hasTeams.set(false);
  }

  async listTeams(): Promise<TeamSummary[]> {
    const body = await this.request<{ teams: TeamSummary[] }>('GET', '/teams');
    this.hasTeams.set(body.teams.length > 0);
    return body.teams;
  }

  async createTeam(input: { name: string; timeZone: string }): Promise<TeamSummary> {
    const team = await this.request<TeamSummary>('POST', '/teams', input);
    this.hasTeams.set(true);
    return team;
  }

  /** Loads one team the caller belongs to. */
  async getTeam(teamId: string): Promise<TeamSummary> {
    return this.request('GET', `/teams/${teamId}`);
  }

  /** Updates the team name, time zone, and location. */
  async updateTeam(teamId: string, input: UpdateTeamBody): Promise<TeamSummary> {
    return this.request('PATCH', `/teams/${teamId}`, input);
  }

  /** Searches the team directory by name for join autocomplete. */
  async searchTeams(
    query: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<{ teams: TeamDirectoryHit[]; cursor?: string }> {
    const params = new URLSearchParams();
    if (query.trim().length > 0) params.set('q', query.trim());
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.cursor !== undefined) params.set('cursor', options.cursor);
    const qs = params.toString();
    return this.request<{ teams: TeamDirectoryHit[]; cursor?: string }>(
      'GET',
      `/teams/directory${qs.length > 0 ? `?${qs}` : ''}`,
    );
  }

  /** Requests membership on a team the caller does not yet belong to. */
  async requestJoin(teamId: string): Promise<{ requestId: string }> {
    return this.request('POST', `/teams/${teamId}/join-requests`);
  }

  async getPermissions(teamId: string): Promise<{ roles: RolePermissions[] }> {
    return this.request('GET', `/teams/${teamId}/permissions`);
  }

  async putPermissions(
    teamId: string,
    roles: RolePermissions[],
  ): Promise<{ roles: RolePermissions[] }> {
    return this.request('PUT', `/teams/${teamId}/permissions`, { roles });
  }

  async getSchedule(
    teamId: string,
    from: string,
    to: string,
  ): Promise<{ occurrences: ScheduleOccurrence[] }> {
    const query = new URLSearchParams({ from, to });
    return this.request('GET', `/schedule/teams/${teamId}?${query}`);
  }

  async createEvent(
    teamId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request('POST', `/schedule/teams/${teamId}/events`, body);
  }

  async putRsvp(
    teamId: string,
    body: { eventId: string; occurrenceStartsAt: string; status: string },
  ): Promise<unknown> {
    return this.request('PUT', `/schedule/teams/${teamId}/rsvps`, body);
  }

  async listChats(): Promise<ChatSummary[]> {
    const body = await this.request<{ chats: ChatSummary[] }>('GET', '/chat');
    return body.chats;
  }

  async listMessages(chatId: string): Promise<{ messages: ChatMessage[] }> {
    return this.request('GET', `/chat/${chatId}/messages`);
  }

  async sendMessage(chatId: string, body: string): Promise<ChatMessage> {
    return this.request('POST', `/chat/${chatId}/messages`, { body });
  }

  async registerDevice(deviceId: string, token: string, platform: string): Promise<void> {
    await this.request('PUT', `/media/devices/${encodeURIComponent(deviceId)}`, {
      token,
      platform,
    });
  }

  /**
   * Authenticated fetch against the local proxy or cloud HTTP API.
   *
   * @param method - HTTP method.
   * @param path - Path beginning with `/teams`, `/chat`, etc.
   * @param body - Optional JSON body.
   * @returns Parsed JSON, or an empty object for `204`.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    const auth = this.session.authorizationHeader();
    if (auth !== undefined) headers['authorization'] = auth;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response = await fetch(`${environment.apiBaseUrl}${path}`, {
      method,
      credentials: this.native ? 'omit' : 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401) {
      const refreshed = await this.refreshSession();
      if (refreshed) {
        const retryAuth = this.session.authorizationHeader();
        if (retryAuth !== undefined) headers['authorization'] = retryAuth;
        response = await fetch(`${environment.apiBaseUrl}${path}`, {
          method,
          credentials: this.native ? 'omit' : 'include',
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      }
    }

    if (response.status === 204) return {} as T;
    if (!response.ok) {
      let code = `http_${response.status}`;
      try {
        const err = (await response.json()) as { error?: string };
        if (typeof err.error === 'string') code = err.error;
      } catch {
        // Keep status-based code.
      }
      throw new Error(code);
    }
    return (await response.json()) as T;
  }
}
