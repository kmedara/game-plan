/**
 * Typed helpers for the product HTTP API.
 */

import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type {
  AcceptedInvite,
  ApprovedJoinRequest,
  ApproveJoinRequestBody,
  ChatList,
  ChatMessage,
  ChatSummary,
  CompleteProfileBody,
  CreateEventBody,
  CreateInviteBody,
  CreatePrivateChatBody,
  CreateTeamBody,
  CreateTeamChannelBody,
  DeviceRegistration,
  EventResponse,
  InvitePreview,
  JoinRequestCreated,
  JoinRequestList,
  LoginBody,
  MessagePage,
  PresignDownloadResponse,
  PresignUploadBody,
  PresignUploadResponse,
  RegisterBody,
  RegisterDeviceBody,
  RolePermissionsResponse,
  RsvpBody,
  RsvpResponse,
  ScheduleList,
  SearchTeamDirectoryQuery,
  SendMessageBody,
  TeamDirectoryPage,
  TeamInvite,
  TeamInviteList,
  TeamList,
  TeamMemberList,
  TeamMemberProfile,
  TeamSummary,
  UpdatePositionsBody,
  UpdateProfileBody,
  UpdateTeamBody,
  UserProfile,
} from '@gameplan/types';
import {
  CapacitorRefreshStore,
  SessionService,
  WebRefreshStore,
} from './session.service';
import { environment } from '../../environments/environment';

/**
 * Session + product API client used by the Angular screens.
 */
@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly native = Capacitor.isNativePlatform();
  private readonly session = new SessionService({
    baseUrl: `${environment.apiBaseUrl}/identity`,
    mode: this.native ? 'native' : 'web',
    refreshStore: this.native
      ? new CapacitorRefreshStore(Preferences)
      : new WebRefreshStore(),
  });

  /** Selected team id for schedule, chats, and branding (persisted). */
  readonly selectedTeamId = signal<string | undefined>(undefined);

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

  /** Preferences key for the team whose colors and schedule stay selected. */
  private readonly selectedTeamKey = 'selected-team-id';

  /** Currently selected team id for schedule and admin screens. */
  getTeamId(): string | undefined {
    return this.selectedTeamId();
  }

  /**
   * Reads the last selected team after a reload.
   *
   * @returns The stored id, or `undefined` when none has been saved.
   */
  async restoreTeamId(): Promise<string | undefined> {
    if (this.selectedTeamId() !== undefined) return this.selectedTeamId();
    try {
      const { value } = await Preferences.get({ key: this.selectedTeamKey });
      if (value !== null && value.length > 0) this.selectedTeamId.set(value);
    } catch {
      // The in-memory id stays empty when preferences cannot be read.
    }
    return this.selectedTeamId();
  }

  /** Selects the active team for schedule and admin screens. */
  setTeamId(teamId: string | undefined): void {
    this.selectedTeamId.set(teamId);
    void this.persistTeamId(teamId);
  }

  /**
   * Stores or clears the selected team so a reload can restore its theme.
   *
   * @param teamId - The team to keep, or `undefined` to forget it.
   */
  private async persistTeamId(teamId: string | undefined): Promise<void> {
    try {
      if (teamId === undefined) {
        await Preferences.remove({ key: this.selectedTeamKey });
        return;
      }
      await Preferences.set({ key: this.selectedTeamKey, value: teamId });
    } catch {
      // The choice still applies for this visit when preferences cannot be written.
    }
  }

  /** Bearer token for WebSocket `?token=`. */
  accessToken(): string | undefined {
    return this.session.getAccessToken();
  }

  async register(input: RegisterBody): Promise<void> {
    await this.session.register(input);
  }

  async login(input: LoginBody): Promise<void> {
    await this.session.login(input);
  }

  /** Loads the signed-in profile, including the photo key when one is set. */
  async getMe(): Promise<UserProfile> {
    const profile = await this.request<UserProfile>('GET', '/identity/me');
    this.session.setUser(profile);
    return profile;
  }

  /** Updates the caller's photo and/or phone number. */
  async updateProfile(input: UpdateProfileBody): Promise<UserProfile> {
    const profile = await this.request<UserProfile>('PATCH', '/identity/profile', input);
    this.session.setUser(profile);
    return profile;
  }

  /** Asks for a short-lived upload URL for a photo or other file. */
  async presignUpload(
    contentType: PresignUploadBody['contentType'],
    contentLength: PresignUploadBody['contentLength'],
  ): Promise<PresignUploadResponse> {
    return this.request('POST', '/media/presign-upload', { contentType, contentLength });
  }

  /** Asks for a short-lived URL that can display an uploaded object. */
  async presignDownload(objectKey: string): Promise<PresignDownloadResponse> {
    const params = new URLSearchParams({ objectKey });
    return this.request('GET', `/media/presign-download?${params}`);
  }

  async completeProfile(input: CompleteProfileBody): Promise<void> {
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
    this.setTeamId(undefined);
    this.hasTeams.set(false);
    if (!environment.authDisabled) {
      const returnTo = encodeURIComponent(`${window.location.origin}/login`);
      window.location.href = `${environment.apiBaseUrl}/identity/oauth/logout?returnTo=${returnTo}`;
      return;
    }
    await this.session.logout();
  }

  async listTeams(): Promise<TeamList['teams']> {
    const body = await this.request<TeamList>('GET', '/teams');
    this.hasTeams.set(body.teams.length > 0);
    return body.teams;
  }

  async createTeam(input: CreateTeamBody): Promise<TeamSummary> {
    const team = await this.request<TeamSummary>('POST', '/teams', input);
    this.hasTeams.set(true);
    return team;
  }

  /** Loads one team the caller belongs to. */
  async getTeam(teamId: string): Promise<TeamSummary> {
    return this.request('GET', `/teams/${teamId}`);
  }

  /** Replaces the positions the caller plays on a team. */
  async setPositions(
    teamId: string,
    positions: UpdatePositionsBody['positions'],
  ): Promise<TeamSummary> {
    return this.request('PUT', `/teams/${teamId}/positions`, { positions });
  }

  /** Updates the team name, time zone, location, and theme. */
  async updateTeam(teamId: string, input: UpdateTeamBody): Promise<TeamSummary> {
    return this.request('PATCH', `/teams/${teamId}`, input);
  }

  /** Searches the team directory by name for join autocomplete. */
  async searchTeams(
    query: string,
    options: Omit<SearchTeamDirectoryQuery, 'q'> = {},
  ): Promise<TeamDirectoryPage> {
    const params = new URLSearchParams();
    if (query.trim().length > 0) params.set('q', query.trim());
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.cursor !== undefined) params.set('cursor', options.cursor);
    const qs = params.toString();
    return this.request<TeamDirectoryPage>(
      'GET',
      `/teams/directory${qs.length > 0 ? `?${qs}` : ''}`,
    );
  }

  /** Requests membership on a team the caller does not yet belong to. */
  async requestJoin(teamId: string): Promise<JoinRequestCreated> {
    return this.request('POST', `/teams/${teamId}/join-requests`);
  }

  /** Lists pending join requests for a team. */
  async listJoinRequests(teamId: string): Promise<JoinRequestList['joinRequests']> {
    const body = await this.request<JoinRequestList>('GET', `/teams/${teamId}/join-requests`);
    return body.joinRequests;
  }

  /**
   * Approves a pending join request and assigns the chosen role.
   *
   * @param teamId - The team that owns the request.
   * @param requestId - The pending request.
   * @param role - Role granted when the request is approved.
   * @returns The new membership.
   */
  async approveJoinRequest(
    teamId: string,
    requestId: string,
    role: ApproveJoinRequestBody['role'],
  ): Promise<ApprovedJoinRequest> {
    return this.request('POST', `/teams/${teamId}/join-requests/${requestId}/approve`, { role });
  }

  /**
   * Declines a pending join request.
   *
   * @param teamId - The team that owns the request.
   * @param requestId - The pending request.
   */
  async rejectJoinRequest(teamId: string, requestId: string): Promise<void> {
    await this.request('POST', `/teams/${teamId}/join-requests/${requestId}/reject`);
  }

  /** Lists shareable invite codes for a team. */
  async listInvites(teamId: string): Promise<TeamInviteList['invites']> {
    const body = await this.request<TeamInviteList>('GET', `/teams/${teamId}/invites`);
    return body.invites;
  }

  /**
   * Creates a multi-use invite that grants the given role on accept.
   *
   * @param teamId - The team that will own the invite.
   * @param role - Role granted when the code is accepted. Defaults to player on the server.
   * @returns The new invite.
   */
  async createInvite(teamId: string, role?: CreateInviteBody['role']): Promise<TeamInvite> {
    return this.request('POST', `/teams/${teamId}/invites`, role === undefined ? {} : { role });
  }

  /**
   * Loads the team and role behind a shared invite code.
   *
   * @param code - The invite code from the link.
   * @returns Invite metadata including the team name.
   */
  async getInvite(code: string): Promise<InvitePreview> {
    return this.request('GET', `/teams/invite/${encodeURIComponent(code)}`);
  }

  /**
   * Joins the team behind an invite code.
   *
   * @param code - The invite code from the link.
   * @returns The membership created by accepting.
   */
  async acceptInvite(code: string): Promise<AcceptedInvite> {
    const membership = await this.request<AcceptedInvite>(
      'POST',
      `/teams/invite/${encodeURIComponent(code)}/accept`,
    );
    this.hasTeams.set(true);
    return membership;
  }

  /** Lists everyone on the team. Any member can call this. */
  async listMembers(teamId: string): Promise<TeamMemberList['members']> {
    const body = await this.request<TeamMemberList>('GET', `/teams/${teamId}/members`);
    return body.members;
  }

  /**
   * Loads one teammate's profile on a team.
   *
   * @param teamId - The team id.
   * @param userId - The roster member's user id.
   * @returns Display fields, role, photo key, and positions.
   */
  async getMember(teamId: string, userId: string): Promise<TeamMemberProfile> {
    return this.request(
      'GET',
      `/teams/${teamId}/members/${encodeURIComponent(userId)}`,
    );
  }

  async getPermissions(teamId: string): Promise<RolePermissionsResponse> {
    return this.request('GET', `/teams/${teamId}/permissions`);
  }

  async putPermissions(
    teamId: string,
    roles: RolePermissionsResponse['roles'],
  ): Promise<RolePermissionsResponse> {
    return this.request('PUT', `/teams/${teamId}/permissions`, { roles });
  }

  async getSchedule(teamId: string, from: string, to: string): Promise<ScheduleList> {
    const query = new URLSearchParams({ from, to });
    return this.request('GET', `/schedule/teams/${teamId}?${query}`);
  }

  async createEvent(teamId: string, body: CreateEventBody): Promise<EventResponse> {
    return this.request('POST', `/schedule/teams/${teamId}/events`, body);
  }

  async putRsvp(teamId: string, body: RsvpBody): Promise<RsvpResponse> {
    return this.request('PUT', `/schedule/teams/${teamId}/rsvps`, body);
  }

  /**
   * Autocompletes places through the API Places proxy.
   *
   * @param query - The typed place text.
   * @returns Suggestion rows for the location field.
   */
  async autocompletePlaces(
    query: string,
  ): Promise<Array<{ id: string; primaryText: string; secondaryText?: string }>> {
    const params = new URLSearchParams({ q: query });
    const body = await this.request<{
      suggestions: Array<{ id: string; primaryText: string; secondaryText?: string }>;
    }>('GET', `/places/autocomplete?${params}`);
    return body.suggestions;
  }

  /**
   * Resolves a place id through the API Places proxy.
   *
   * @param id - The place id from autocomplete.
   * @returns Label and coordinates.
   */
  async resolvePlace(id: string): Promise<{
    label: string;
    latitude: number;
    longitude: number;
  }> {
    const params = new URLSearchParams({ id });
    return this.request('GET', `/places/resolve?${params}`);
  }

  /**
   * Reverse-geocodes a map pin through the API Places proxy.
   *
   * @param latitude - Latitude in decimal degrees.
   * @param longitude - Longitude in decimal degrees.
   * @returns Label and coordinates.
   */
  async reverseGeocodePlace(
    latitude: number,
    longitude: number,
  ): Promise<{
    label: string;
    latitude: number;
    longitude: number;
  }> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
    });
    return this.request('GET', `/places/reverse?${params}`);
  }

  async listChats(): Promise<ChatList['chats']> {
    const body = await this.request<ChatList>('GET', '/chat');
    return body.chats;
  }

  /**
   * Exact-email adult search for starting a private chat.
   *
   * @param email - The email to look up.
   * @returns The matching public profile.
   */
  async searchChatUser(email: string): Promise<UserProfile> {
    const params = new URLSearchParams({ email: email.trim() });
    const body = await this.request<{ user: UserProfile }>(
      'GET',
      `/chat/users/search?${params}`,
    );
    return body.user;
  }

  async createPrivateChat(
    memberIds: CreatePrivateChatBody['memberIds'],
  ): Promise<ChatSummary> {
    return this.request('POST', '/chat/private', { memberIds });
  }

  async createTeamChannel(
    teamId: string,
    name: CreateTeamChannelBody['name'],
  ): Promise<ChatSummary> {
    return this.request('POST', '/chat/channels', { teamId, name });
  }

  async listMessages(chatId: string): Promise<MessagePage> {
    return this.request('GET', `/chat/${chatId}/messages`);
  }

  /**
   * Sends a chat message. `attachmentKeys` is a plain string list at the call
   * site; generated {@link SendMessageBody} types it as a max-10 tuple union.
   */
  async sendMessage(
    chatId: string,
    body: { body: string; attachmentKeys?: string[] },
  ): Promise<ChatMessage> {
    return this.request('POST', `/chat/${chatId}/messages`, body as SendMessageBody);
  }

  async registerDevice(
    deviceId: string,
    token: RegisterDeviceBody['token'],
    platform: RegisterDeviceBody['platform'],
  ): Promise<DeviceRegistration> {
    return this.request('PUT', `/media/devices/${encodeURIComponent(deviceId)}`, {
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
    const response = await this.fetchAuthorized(method, path, body);
    if (response.status === 204) return {} as T;
    if (!response.ok) throw new Error(await this.errorCode(response));
    return (await response.json()) as T;
  }

  /**
   * Runs an authenticated fetch with one refresh retry on `401`.
   *
   * @param method - HTTP method.
   * @param path - API path.
   * @param body - Optional JSON body.
   * @returns The raw fetch response.
   */
  private async fetchAuthorized(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
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

    return response;
  }

  /**
   * Reads a stable error code from a failed API response.
   *
   * @param response - The failed fetch response.
   * @returns An `error` field from JSON, or `http_<status>`.
   */
  private async errorCode(response: Response): Promise<string> {
    let code = `http_${response.status}`;
    try {
      const err = (await response.json()) as { error?: string };
      if (typeof err.error === 'string') code = err.error;
    } catch {
      // Keep status-based code.
    }
    return code;
  }
}
