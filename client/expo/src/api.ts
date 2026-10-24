/**
 * Session and product HTTP client used by the Expo screens.
 */

import { Platform } from 'react-native';
import {
  SessionService,
  WebRefreshStore,
  withContentHash,
  type SessionTokens,
  type UserProfile,
} from '@gameplan/client-session';
import type {
  AcceptedInvite,
  ApprovedJoinRequest,
  BillingInterval,
  OauthProviders,
  OrgDetail,
  OrgList,
  OrgSummary,
  TeamOrgStatus,
  CalendarFeed,
  ClaimSignupBody,
  CreatePollBody,
  PollTally,
  PutSignupsBody,
  SignupsResponse,
  MedicalInfo,
  MedicalInfoBody,
  MedicalPeople,
  MemberMedical,
  Preferences,
  UpdatePreferencesBody,
  SupportRequestBody,
  TeamBilling,
  Charge,
  ChargeDetail,
  ChargeList,
  CreateChargeBody,
  Due,
  MyDues,
  PaymentAccount,
  PaymentRedirect,
  UpdateDueBody,
  ApproveJoinRequestBody,
  ChatList,
  ChatMessage,
  ChatSummary,
  CompleteProfileBody,
  CreateEventBody,
  ExceptionEventBody,
  OccurrenceTarget,
  CreateInviteBody,
  CreatePrivateChatBody,
  CreateTeamBody,
  CreateTeamChannelBody,
  DeviceRegistration,
  AcceptFixtureBody,
  EventResponse,
  Fixture,
  FixtureList,
  InvitePreview,
  JoinRequestCreated,
  JoinRequestList,
  MessageHistoryQuery,
  MessagePage,
  OauthExchangeResponse,
  PresignDownloadQuery,
  PresignDownloadResponse,
  ProposeFixtureBody,
  PresignUploadBody,
  PresignUploadResponse,
  RegisterDeviceBody,
  RolePermissionsResponse,
  CarpoolClaimBody,
  CarpoolOfferBody,
  CarpoolQuery,
  CarpoolResponse,
  LineupBody,
  LineupQuery,
  LineupResponse,
  RsvpBody,
  RsvpResponse,
  ScheduleList,
  SearchTeamDirectoryQuery,
  SendInviteBody,
  SendMessageBody,
  SentInvite,
  SocketTicket,
  TeamDirectoryPage,
  TeamInvite,
  TeamInviteList,
  TeamList,
  TeamRole,
  TeamMemberList,
  TeamMemberProfile,
  TeamSummary,
  UpdateEventBody,
  UpdateFixtureBody,
  UpdatePositionsBody,
  UpdateProfileBody,
  UpdateTeamBody,
} from '@gameplan/types';
import { config } from './config';
import {
  ExpoRefreshStore,
  SELECTED_TEAM_KEY,
  SESSION_HINT_KEY,
  readPreference,
  writePreference,
} from './refresh-store';

type Listener = () => void;

/**
 * Thrown when the account cannot be deleted yet.
 *
 * The person owns an organization, or is the only admin of a team that still
 * has members or pays for its own plan, and has to hand it over first.
 */
export class AccountDeletionBlocked extends Error {
  constructor(
    readonly ownedOrgs: readonly string[],
    readonly soleAdminTeams: readonly string[],
  ) {
    super('account_deletion_blocked');
  }
}

/** Fetch for API calls. Writes carry the body hash the function URLs require. */
const apiFetch = withContentHash((input, init) => fetch(input, init));

/**
 * Typed helpers for identity, teams, schedule, chat, places, media, and payments.
 */
export class ApiClient {
  readonly native = Platform.OS !== 'web';
  private readonly session = new SessionService({
    baseUrl: `${config.apiBaseUrl}/identity`,
    mode: this.native ? 'native' : 'web',
    refreshStore: this.native ? new ExpoRefreshStore() : new WebRefreshStore(),
  });
  private teamId: string | undefined;
  private readonly listeners = new Set<Listener>();

  /** Subscribes to team and profile changes. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  get user(): UserProfile | undefined {
    return this.session.getUser();
  }

  get selectedTeamId(): string | undefined {
    return this.teamId;
  }

  isAuthenticated(): boolean {
    return this.session.isAuthenticated();
  }

  /** Reads the last selected team after a reload. */
  async restoreTeamId(): Promise<string | undefined> {
    if (this.teamId !== undefined) return this.teamId;
    const value = await readPreference(SELECTED_TEAM_KEY, this.native);
    if (value !== undefined) {
      this.teamId = value;
      this.emit();
    }
    return this.teamId;
  }

  /** Selects the active team for schedule and admin screens. */
  setTeamId(teamId: string | undefined): void {
    this.teamId = teamId;
    this.emit();
    void writePreference(SELECTED_TEAM_KEY, teamId, this.native);
  }

  /** Drops the previous account's selected team. */
  clearTeamContext(): void {
    this.setTeamId(undefined);
  }

  /** Stores a session returned by the native OAuth exchange. */
  async adoptSession(tokens: SessionTokens): Promise<void> {
    await this.session.adopt(tokens);
    this.emit();
  }

  issueSocketTicket(): Promise<SocketTicket> {
    return this.request<SocketTicket>('POST', '/identity/socket-ticket');
  }

  async getMe(): Promise<UserProfile> {
    const profile = await this.request<UserProfile>('GET', '/identity/me');
    this.session.setUser(profile);
    this.emit();
    return profile;
  }

  async listMedical(): Promise<MedicalPeople['people']> {
    const data = await this.request<MedicalPeople>('GET', '/identity/medical');
    return data.people;
  }

  async putMedical(userId: string, body: MedicalInfoBody): Promise<MedicalInfo> {
    return this.request('PUT', `/identity/medical/${userId}`, body);
  }

  async getMemberMedical(teamId: string, userId: string): Promise<MemberMedical> {
    return this.request('GET', `/teams/${teamId}/members/${userId}/medical`);
  }

  async getCalendarFeed(): Promise<CalendarFeed> {
    return this.request('GET', '/schedule/feed');
  }

  async rotateCalendarFeed(): Promise<CalendarFeed> {
    return this.request('POST', '/schedule/feed/rotate');
  }

  async getPreferences(): Promise<Preferences> {
    return this.request('GET', '/identity/me/preferences');
  }

  async updatePreferences(body: UpdatePreferencesBody): Promise<Preferences> {
    return this.request('PATCH', '/identity/me/preferences', body);
  }

  async sendSupportRequest(body: SupportRequestBody): Promise<void> {
    await this.request('POST', '/identity/support', body);
  }

  async updateProfile(input: UpdateProfileBody): Promise<UserProfile> {
    const profile = await this.request<UserProfile>('PATCH', '/identity/profile', input);
    this.session.setUser(profile);
    this.emit();
    return profile;
  }

  async presignUpload(
    contentType: PresignUploadBody['contentType'],
    contentLength: PresignUploadBody['contentLength'],
  ): Promise<PresignUploadResponse> {
    return this.request('POST', '/media/presign-upload', { contentType, contentLength });
  }

  async presignDownload(
    objectKey: string,
    context: Pick<PresignDownloadQuery, 'chatId' | 'userId' | 'teamId'> = {},
  ): Promise<PresignDownloadResponse> {
    const params = new URLSearchParams({ objectKey });
    if (context.chatId !== undefined) params.set('chatId', context.chatId);
    if (context.userId !== undefined) params.set('userId', context.userId);
    if (context.teamId !== undefined) params.set('teamId', context.teamId);
    return this.request('GET', `/media/presign-download?${params}`);
  }

  async completeProfile(input: CompleteProfileBody): Promise<void> {
    const profile = await this.request<UserProfile>('POST', '/identity/profile/complete', input);
    this.session.setUser(profile);
    this.emit();
  }

  /**
   * Returns whether a stored session might restore.
   *
   * Native and local bypass runs always try, because the refresh call returns
   * without a network request when nothing is stored. The website reads
   * {@link SESSION_HINT_KEY}.
   */
  async mightHaveSession(): Promise<boolean> {
    if (this.native || config.authDisabled) return true;
    return (await readPreference(SESSION_HINT_KEY, false)) !== undefined;
  }

  async refreshSession(): Promise<boolean> {
    try {
      await this.session.refresh();
      this.setSessionHint(true);
      this.emit();
      return true;
    } catch (error) {
      // A failed connection says nothing about the cookie, so the hint stays.
      if (!(error instanceof TypeError)) this.setSessionHint(false);
      return false;
    }
  }

  /**
   * Restores a session when none is in memory, or refreshes one that is about
   * to expire. A fresh access token is left alone so `/`, the persist-cache
   * buster, and the signed-in shell do not each call `/identity/refresh`.
   *
   * Use {@link refreshSession} after a `401`. That path must hit identity.
   */
  async ensureSession(): Promise<boolean> {
    if (this.isAuthenticated() && !this.session.needsAccessRefresh()) return true;
    return this.refreshSession();
  }

  private setSessionHint(present: boolean): void {
    if (this.native) return;
    void writePreference(SESSION_HINT_KEY, present ? '1' : undefined, false);
  }

  /**
   * Redeems a native Hosted UI handoff code.
   *
   * @param code - The code from `gameplan://auth`.
   * @returns The session and the route to open.
   */
  async exchangeOAuth(code: string): Promise<OauthExchangeResponse> {
    const response = await apiFetch(`${config.apiBaseUrl}/identity/oauth/exchange`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json', 'x-refresh-delivery': 'body' },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) throw new Error(await errorCode(response));
    const tokens = (await response.json()) as OauthExchangeResponse;
    await this.session.adopt(tokens);
    this.emit();
    return tokens;
  }

  /**
   * Social sign-ins this deployment offers. Any failure shows none, which
   * leaves the email sign-in, so the login screen still works offline.
   *
   * @returns Providers in the order the login screen shows them.
   */
  async oauthProviders(): Promise<OauthProviders['providers']> {
    try {
      const response = await apiFetch(`${config.apiBaseUrl}/identity/oauth/providers`, { credentials: 'omit' });
      if (!response.ok) return [];
      return ((await response.json()) as OauthProviders).providers;
    } catch {
      return [];
    }
  }

  /**
   * Deletes the signed-in account, then forgets the session on this device.
   *
   * @throws {@link AccountDeletionBlocked} when something has to be handed over first.
   */
  async deleteAccount(): Promise<void> {
    const response = await this.fetchAuthorized('DELETE', '/identity/me');
    if (response.status === 409) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        ownedOrgs?: string[];
        soleAdminTeams?: string[];
      };
      if (body.error === 'account_deletion_blocked') {
        throw new AccountDeletionBlocked(body.ownedOrgs ?? [], body.soleAdminTeams ?? []);
      }
    }
    if (!response.ok) throw new Error(await errorCode(response));
    this.clearTeamContext();
    this.setSessionHint(false);
    try {
      // The account is gone, so the revoke may fail; the local session still has to go.
      await this.session.logout();
    } catch {
      // Already signed out on the server.
    }
    this.emit();
  }

  async logout(): Promise<void> {
    this.clearTeamContext();
    this.setSessionHint(false);
    if (!config.authDisabled && !this.native && typeof window !== 'undefined') {
      const returnTo = encodeURIComponent(`${window.location.origin}/login`);
      window.location.href = `${config.apiBaseUrl}/identity/oauth/logout?returnTo=${returnTo}`;
      return;
    }
    await this.session.logout();
    this.emit();
  }

  async listTeams(): Promise<TeamList['teams']> {
    const body = await this.request<TeamList>('GET', '/teams');
    return body.teams;
  }

  async createTeam(input: CreateTeamBody): Promise<TeamSummary> {
    return this.request<TeamSummary>('POST', '/teams', input);
  }

  async getTeam(teamId: string): Promise<TeamSummary> {
    return this.request('GET', `/teams/${teamId}`);
  }

  async setPositions(
    teamId: string,
    positions: UpdatePositionsBody['positions'],
  ): Promise<TeamSummary> {
    return this.request('PUT', `/teams/${teamId}/positions`, { positions });
  }

  async updateTeam(teamId: string, input: UpdateTeamBody): Promise<TeamSummary> {
    return this.request('PATCH', `/teams/${teamId}`, input);
  }

  async searchTeams(
    query: string,
    options: Omit<SearchTeamDirectoryQuery, 'q'> = {},
  ): Promise<TeamDirectoryPage> {
    const params = new URLSearchParams();
    if (query.trim().length > 0) params.set('q', query.trim());
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.cursor !== undefined) params.set('cursor', options.cursor);
    const qs = params.toString();
    return this.request('GET', `/teams/directory${qs.length > 0 ? `?${qs}` : ''}`);
  }

  async requestJoin(teamId: string): Promise<JoinRequestCreated> {
    return this.request('POST', `/teams/${teamId}/join-requests`);
  }

  async listJoinRequests(teamId: string): Promise<JoinRequestList['joinRequests']> {
    const body = await this.request<JoinRequestList>('GET', `/teams/${teamId}/join-requests`);
    return body.joinRequests;
  }

  async approveJoinRequest(
    teamId: string,
    requestId: string,
    role: ApproveJoinRequestBody['role'],
  ): Promise<ApprovedJoinRequest> {
    return this.request('POST', `/teams/${teamId}/join-requests/${requestId}/approve`, { role });
  }

  async rejectJoinRequest(teamId: string, requestId: string): Promise<void> {
    await this.request('POST', `/teams/${teamId}/join-requests/${requestId}/reject`);
  }

  async listInvites(teamId: string): Promise<TeamInviteList['invites']> {
    const body = await this.request<TeamInviteList>('GET', `/teams/${teamId}/invites`);
    return body.invites;
  }

  async createInvite(teamId: string, role?: CreateInviteBody['role']): Promise<TeamInvite> {
    return this.request('POST', `/teams/${teamId}/invites`, role === undefined ? {} : { role });
  }

  /** GamePlan emails or texts the role's code from its own address or number. */
  async sendInvite(teamId: string, body: SendInviteBody): Promise<SentInvite> {
    return this.request('POST', `/teams/${teamId}/invites/send`, body);
  }

  async deleteInvite(teamId: string, role: TeamInvite['role']): Promise<void> {
    await this.request('DELETE', `/teams/${teamId}/invites/${encodeURIComponent(role)}`);
  }

  async getInvite(code: string): Promise<InvitePreview> {
    return this.request('GET', `/teams/invite/${encodeURIComponent(code)}`);
  }

  async acceptInvite(code: string): Promise<AcceptedInvite> {
    return this.request<AcceptedInvite>(
      'POST',
      `/teams/invite/${encodeURIComponent(code)}/accept`,
    );
  }

  async listMembers(teamId: string): Promise<TeamMemberList['members']> {
    const body = await this.request<TeamMemberList>('GET', `/teams/${teamId}/members`);
    return body.members;
  }

  async getMember(teamId: string, userId: string): Promise<TeamMemberProfile> {
    return this.request('GET', `/teams/${teamId}/members/${encodeURIComponent(userId)}`);
  }

  async assignMemberRoles(
    teamId: string,
    userId: string,
    roles: readonly TeamRole[],
  ): Promise<TeamMemberProfile> {
    return this.request('PATCH', `/teams/${teamId}/members/${encodeURIComponent(userId)}`, { roles });
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

  async getEvent(teamId: string, eventId: string): Promise<EventResponse> {
    return this.request('GET', `/schedule/teams/${teamId}/events/${encodeURIComponent(eventId)}`);
  }

  async updateEvent(teamId: string, eventId: string, body: UpdateEventBody): Promise<EventResponse> {
    return this.request('PATCH', `/schedule/teams/${teamId}/events/${encodeURIComponent(eventId)}`, body);
  }

  async listFixtures(teamId: string): Promise<FixtureList> {
    return this.request('GET', `/schedule/teams/${teamId}/fixtures`);
  }

  async proposeFixture(teamId: string, eventId: string, body: ProposeFixtureBody): Promise<Fixture> {
    return this.request(
      'POST',
      `/schedule/teams/${teamId}/events/${encodeURIComponent(eventId)}/fixture`,
      body,
    );
  }

  async acceptFixture(fixtureId: string, body: AcceptFixtureBody): Promise<Fixture> {
    return this.request('POST', `/schedule/fixtures/${encodeURIComponent(fixtureId)}/accept`, body);
  }

  async declineFixture(fixtureId: string): Promise<void> {
    await this.request('POST', `/schedule/fixtures/${encodeURIComponent(fixtureId)}/decline`);
  }

  async updateFixture(fixtureId: string, body: UpdateFixtureBody): Promise<Fixture> {
    return this.request('PATCH', `/schedule/fixtures/${encodeURIComponent(fixtureId)}`, body);
  }

  async unlinkFixture(fixtureId: string): Promise<void> {
    await this.request('DELETE', `/schedule/fixtures/${encodeURIComponent(fixtureId)}`);
  }

  async deleteEvent(teamId: string, eventId: string): Promise<void> {
    await this.request('DELETE', `/schedule/teams/${teamId}/events/${encodeURIComponent(eventId)}`);
  }

  async saveOccurrence(teamId: string, eventId: string, body: ExceptionEventBody): Promise<EventResponse> {
    return this.request(
      'POST',
      `/schedule/teams/${teamId}/events/${encodeURIComponent(eventId)}/occurrences`,
      body,
    );
  }

  async cancelOccurrence(teamId: string, eventId: string, body: OccurrenceTarget): Promise<void> {
    await this.request(
      'DELETE',
      `/schedule/teams/${teamId}/events/${encodeURIComponent(eventId)}/occurrences`,
      body,
    );
  }

  async putRsvp(teamId: string, body: RsvpBody): Promise<RsvpResponse> {
    return this.request('PUT', `/schedule/teams/${teamId}/rsvps`, body);
  }

  async getLineup(
    teamId: string,
    query: LineupQuery,
  ): Promise<LineupResponse> {
    const params = new URLSearchParams({
      eventId: query.eventId,
      occurrenceStartsAt: query.occurrenceStartsAt,
    });
    if (query.source !== undefined) params.set('source', query.source);
    return this.request('GET', `/schedule/teams/${teamId}/lineup?${params}`);
  }

  async putLineup(teamId: string, body: LineupBody): Promise<LineupResponse> {
    return this.request('PUT', `/schedule/teams/${teamId}/lineup`, body);
  }

  async createPoll(chatId: string, body: CreatePollBody): Promise<ChatMessage> {
    return this.request('POST', `/chat/${chatId}/polls`, body);
  }

  async votePoll(chatId: string, messageId: string, optionIds: string[]): Promise<PollTally> {
    return this.request('PUT', `/chat/${chatId}/polls/${messageId}/vote`, { optionIds });
  }

  async getSignups(teamId: string, eventId: string, occurrenceStartsAt: string): Promise<SignupsResponse> {
    const params = new URLSearchParams({ eventId, occurrenceStartsAt });
    return this.request('GET', `/schedule/teams/${teamId}/signups?${params}`);
  }

  async putSignups(teamId: string, body: PutSignupsBody): Promise<SignupsResponse> {
    return this.request('PUT', `/schedule/teams/${teamId}/signups`, body);
  }

  async claimSignup(teamId: string, body: ClaimSignupBody): Promise<SignupsResponse> {
    return this.request('PUT', `/schedule/teams/${teamId}/signups/claim`, body);
  }

  async getCarpool(teamId: string, query: CarpoolQuery): Promise<CarpoolResponse> {
    const params = new URLSearchParams({
      eventId: query.eventId,
      occurrenceStartsAt: query.occurrenceStartsAt,
    });
    return this.request('GET', `/schedule/teams/${teamId}/carpool?${params}`);
  }

  async putCarpool(teamId: string, body: CarpoolOfferBody): Promise<CarpoolResponse> {
    return this.request('PUT', `/schedule/teams/${teamId}/carpool`, body);
  }

  async claimCarpool(teamId: string, body: CarpoolClaimBody): Promise<CarpoolResponse> {
    return this.request('PUT', `/schedule/teams/${teamId}/carpool/claim`, body);
  }

  /** Where Stripe should send this device back after a hosted page. */
  private get paymentReturn(): { returnTo: 'app' | 'web' } {
    return { returnTo: this.native ? 'app' : 'web' };
  }

  async listOrgs(): Promise<OrgList['orgs']> {
    return (await this.request<OrgList>('GET', '/orgs')).orgs;
  }

  async createOrg(name: string): Promise<OrgSummary> {
    return this.request('POST', '/orgs', { name });
  }

  async getOrg(orgId: string): Promise<OrgDetail> {
    return this.request('GET', `/orgs/${orgId}`);
  }

  async renameOrg(orgId: string, name: string): Promise<OrgSummary> {
    return this.request('PATCH', `/orgs/${orgId}`, { name });
  }

  async addOrgAdmin(orgId: string, email: string): Promise<OrgDetail> {
    return this.request('POST', `/orgs/${orgId}/admins`, { email });
  }

  async removeOrgAdmin(orgId: string, adminId: string): Promise<void> {
    await this.request('DELETE', `/orgs/${orgId}/admins/${adminId}`);
  }

  async inviteOrgTeam(orgId: string, teamId: string): Promise<OrgDetail> {
    return this.request('POST', `/orgs/${orgId}/teams/${teamId}`);
  }

  async removeOrgTeam(orgId: string, teamId: string): Promise<void> {
    await this.request('DELETE', `/orgs/${orgId}/teams/${teamId}`);
  }

  async getTeamOrg(teamId: string): Promise<TeamOrgStatus> {
    return this.request('GET', `/orgs/teams/${teamId}`);
  }

  async answerOrgInvite(orgId: string, teamId: string, accept: boolean): Promise<TeamOrgStatus> {
    return this.request('POST', `/orgs/${orgId}/teams/${teamId}/${accept ? 'accept' : 'decline'}`);
  }

  async announceToOrg(orgId: string, body: string): Promise<{ sent: number }> {
    return this.request('POST', `/orgs/${orgId}/announcements`, { body });
  }

  async createOrgCheckout(orgId: string, interval: BillingInterval): Promise<PaymentRedirect> {
    return this.request('POST', `/billing/orgs/${orgId}/checkout`, { interval, ...this.paymentReturn });
  }

  async createOrgPortal(orgId: string): Promise<PaymentRedirect> {
    return this.request('POST', `/billing/orgs/${orgId}/portal`, this.paymentReturn);
  }

  async getTeamBilling(teamId: string): Promise<TeamBilling> {
    return this.request('GET', `/billing/teams/${teamId}`);
  }

  async createTeamCheckout(teamId: string, interval: BillingInterval): Promise<PaymentRedirect> {
    return this.request('POST', `/billing/teams/${teamId}/checkout`, { interval, ...this.paymentReturn });
  }

  async createBillingPortal(teamId: string): Promise<PaymentRedirect> {
    return this.request('POST', `/billing/teams/${teamId}/portal`, this.paymentReturn);
  }

  async getPaymentAccount(teamId: string): Promise<PaymentAccount> {
    return this.request('GET', `/payments/teams/${teamId}/account`);
  }

  async createPaymentAccountLink(teamId: string): Promise<PaymentRedirect> {
    return this.request('POST', `/payments/teams/${teamId}/account/link`, this.paymentReturn);
  }

  async listCharges(teamId: string): Promise<ChargeList['charges']> {
    const data = await this.request<ChargeList>('GET', `/payments/teams/${teamId}/charges`);
    return data.charges;
  }

  async createCharge(teamId: string, body: CreateChargeBody): Promise<Charge> {
    return this.request('POST', `/payments/teams/${teamId}/charges`, body);
  }

  async getCharge(teamId: string, chargeId: string): Promise<ChargeDetail> {
    return this.request('GET', `/payments/teams/${teamId}/charges/${chargeId}`);
  }

  async updateDue(teamId: string, chargeId: string, memberId: string, body: UpdateDueBody): Promise<Due> {
    return this.request('PATCH', `/payments/teams/${teamId}/charges/${chargeId}/dues/${memberId}`, body);
  }

  async listMyDues(): Promise<MyDues['dues']> {
    const data = await this.request<MyDues>('GET', '/payments/me/dues');
    return data.dues;
  }

  async createCheckout(teamId: string, chargeId: string, memberId: string): Promise<PaymentRedirect> {
    return this.request(
      'POST',
      `/payments/teams/${teamId}/charges/${chargeId}/dues/${memberId}/checkout`,
      this.paymentReturn,
    );
  }

  async autocompletePlaces(
    query: string,
  ): Promise<Array<{ id: string; primaryText: string; secondaryText?: string }>> {
    const params = new URLSearchParams({ q: query });
    const body = await this.request<{
      suggestions: Array<{ id: string; primaryText: string; secondaryText?: string }>;
    }>('GET', `/places/autocomplete?${params}`);
    return body.suggestions;
  }

  async resolvePlace(id: string): Promise<{ label: string; latitude: number; longitude: number }> {
    const params = new URLSearchParams({ id });
    return this.request('GET', `/places/resolve?${params}`);
  }

  async reverseGeocodePlace(
    latitude: number,
    longitude: number,
  ): Promise<{ label: string; latitude: number; longitude: number }> {
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

  async searchChatUser(email: string): Promise<UserProfile> {
    const params = new URLSearchParams({ email: email.trim() });
    const body = await this.request<{ user: UserProfile }>('GET', `/chat/users/search?${params}`);
    return body.user;
  }

  async createPrivateChat(body: CreatePrivateChatBody): Promise<ChatSummary> {
    return this.request('POST', '/chat/private', body);
  }

  async createTeamChannel(teamId: string, name: CreateTeamChannelBody['name']): Promise<ChatSummary> {
    return this.request('POST', '/chat/channels', { teamId, name });
  }

  async listMessages(chatId: string, options: MessageHistoryQuery = {}): Promise<MessagePage> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.cursor !== undefined) params.set('cursor', options.cursor);
    const qs = params.toString();
    return this.request('GET', `/chat/${chatId}/messages${qs.length > 0 ? `?${qs}` : ''}`);
  }

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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchAuthorized(method, path, body);
    if (response.status === 204) return {} as T;
    if (!response.ok) throw new Error(await errorCode(response));
    return (await response.json()) as T;
  }

  private async fetchAuthorized(method: string, path: string, body?: unknown): Promise<Response> {
    if (this.session.needsAccessRefresh()) await this.refreshSession();
    const headers: Record<string, string> = {};
    const auth = this.session.authorizationHeader();
    if (auth !== undefined) headers.authorization = auth;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const run = (): Promise<Response> =>
      apiFetch(`${config.apiBaseUrl}${path}`, {
        method,
        credentials: this.native ? 'omit' : 'include',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let response = await run();
    if (response.status === 401) {
      const refreshed = await this.refreshSession();
      if (refreshed) {
        const retryAuth = this.session.authorizationHeader();
        if (retryAuth !== undefined) headers.authorization = retryAuth;
        response = await run();
      }
    }
    return response;
  }
}

const errorCode = async (response: Response): Promise<string> => {
  let code = `http_${response.status}`;
  try {
    const err = (await response.json()) as { error?: string };
    if (typeof err.error === 'string') code = err.error;
  } catch {
    // Keep the status-based code.
  }
  return code;
};
