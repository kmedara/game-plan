/**
 * Teams list, join/create onboarding, and the team admin screen.
 */

import { Component, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
  type ValidatorFn,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  MatAutocomplete,
  MatAutocompleteModule,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type {
  JoinRequest,
  RolePermissions,
  TeamDirectoryHit,
  TeamInvite,
  TeamMember,
  TeamSummary,
  TeamTheme,
} from '@gameplan/types';
import { ApiClient } from '../core/api-client';
import { TeamBrand } from '../core/team-brand';
import {
  TEAM_PERMISSIONS,
  TEAM_ROLES,
  type TeamPermission,
  type TeamRole,
} from '@gameplan/types';

/** Page size for join-team directory autocomplete. */
const DIRECTORY_PAGE_SIZE = 10;

/** Pixels from the panel bottom that trigger the next directory page. */
const DIRECTORY_SCROLL_THRESHOLD_PX = 32;
/** IANA time zones known to the browser; some engines omit `UTC` from the list. */
const TIME_ZONES: readonly string[] = (() => {
  const zones = Intl.supportedValuesOf('timeZone');
  return zones.includes('UTC') ? zones : [...zones, 'UTC'].sort();
})();
const TIME_ZONE_SET = new Set(TIME_ZONES);

/**
 * Time zones matching the text typed into the time zone combo box.
 *
 * @param query - The typed text; spaces match underscores (`new york` → `America/New_York`).
 * @returns The matching IANA names, or every zone when the query is empty.
 */
function filterTimeZones(query: string): readonly string[] {
  const needle = query.trim().toLowerCase().replace(/\s+/g, '_');
  if (needle.length === 0) return TIME_ZONES;
  return TIME_ZONES.filter((zone) => zone.toLowerCase().includes(needle));
}

/** Rejects any non-empty value that is not an exact IANA time zone name. */
const timeZoneValidator: ValidatorFn = (control) =>
  typeof control.value === 'string' && control.value.length > 0 && !TIME_ZONE_SET.has(control.value)
    ? { timeZone: true }
    : null;

/**
 * Sentence for a failed approve or decline.
 *
 * @param err - The error thrown by the API client.
 * @returns Text to show on the admin page.
 */
function joinRequestMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : '';
  if (code === 'minor_cannot_be_team_admin') return 'A minor cannot be a team admin.';
  if (code === 'minor_cannot_hold_manage_permissions') {
    return 'A minor cannot hold a role that manages permissions.';
  }
  if (code === 'already_a_member') return 'They are already on the team.';
  if (code === 'join_request_not_found' || code === 'not_found') {
    return 'That request is no longer pending.';
  }
  return 'Could not update the join request.';
}

/** Display names for team roles on invite controls. */
const ROLE_LABELS: Record<TeamRole, string> = {
  team_admin: 'Team admin',
  coach: 'Coach',
  parent: 'Parent',
  player: 'Player',
};

/**
 * Display name for a team role.
 *
 * @param role - The stored role.
 * @returns A readable label, such as `Team admin`.
 */
export const roleLabel = (role: string): string =>
  role in ROLE_LABELS ? ROLE_LABELS[role as TeamRole] : role;

/**
 * Reads an invite code from a pasted link or a bare code.
 *
 * @param raw - Text from the invite-code field or a shared URL.
 * @returns The code, or an empty string when the input is blank.
 */
export const inviteCodeFromInput = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  try {
    const url = new URL(trimmed, 'http://local');
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    const index = parts.lastIndexOf('invite');
    const code = index >= 0 ? parts[index + 1] : undefined;
    if (code !== undefined && code.length > 0) return decodeURIComponent(code);
  } catch {
    // The text is a code, not a URL.
  }
  return trimmed;
};

@Component({
  selector: 'app-teams',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './teams.html',
})
export class TeamsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly teamBrand = inject(TeamBrand);
  readonly roleLabel = roleLabel;

  @ViewChild('joinAuto') private joinAuto?: MatAutocomplete;

  readonly teams = signal<TeamSummary[]>([]);
  /** Team ids with join requests the caller is allowed to approve. */
  readonly pendingApprovalTeamIds = signal<ReadonlySet<string>>(new Set());
  readonly error = signal<string | undefined>(undefined);
  readonly joinMessage = signal<string | undefined>(undefined);
  readonly mode = signal<'join' | 'create' | undefined>(undefined);
  readonly directoryHits = signal<TeamDirectoryHit[]>([]);
  readonly directoryLoadingMore = signal(false);
  readonly selectedJoin = signal<TeamDirectoryHit | undefined>(undefined);

  readonly joinControl = new FormControl<string | TeamDirectoryHit>('', { nonNullable: true });
  readonly inviteCode = new FormControl('', { nonNullable: true });
  private searchSeq = 0;
  private approvalSeq = 0;
  private directoryQuery = '';
  private directoryCursor: string | undefined;
  private joinPanelEl: HTMLElement | undefined;

  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    timeZone: ['America/New_York', [Validators.required, timeZoneValidator]],
  });
  private readonly timeZoneQuery = toSignal(this.form.controls.timeZone.valueChanges, {
    initialValue: '',
  });
  readonly timeZoneOptions = computed(() => filterTimeZones(this.timeZoneQuery()));

  ngOnInit(): void {
    this.joinControl.valueChanges.subscribe((value) => {
      if (typeof value !== 'string') {
        this.selectedJoin.set(value);
        return;
      }
      this.selectedJoin.set(undefined);
      void this.searchDirectory(value);
    });
    void this.load();
    void this.searchDirectory('');
  }

  ngOnDestroy(): void {
    this.approvalSeq += 1;
    this.detachJoinPanelScroll();
  }

  /**
   * Whether this team has join requests the caller can approve.
   *
   * @param teamId - The team row.
   * @returns True when Admin should be replaced by the notification bell.
   */
  hasPendingApprovals(teamId: string): boolean {
    return this.pendingApprovalTeamIds().has(teamId);
  }

  /**
   * Label shown in the join autocomplete for a selected team.
   *
   * @param team - The selected directory hit, or null while clearing.
   * @returns The team name, or an empty string.
   */
  displayTeam = (team: TeamDirectoryHit | string | null): string => {
    if (team === null || typeof team === 'string') return team ?? '';
    return team.name;
  };

  /**
   * Remembers the team chosen from the join autocomplete panel.
   *
   * @param team - The selected directory hit.
   */
  onJoinSelected(team: TeamDirectoryHit): void {
    this.selectedJoin.set(team);
    this.error.set(undefined);
    this.joinMessage.set(undefined);
  }

  /**
   * Listens for scroll on the open autocomplete panel so the next page can load.
   */
  onJoinPanelOpened(): void {
    queueMicrotask(() => {
      const panel = this.joinAuto?.panel?.nativeElement as HTMLElement | undefined;
      if (panel === undefined) return;
      this.detachJoinPanelScroll();
      this.joinPanelEl = panel;
      panel.addEventListener('scroll', this.onJoinPanelScroll);
    });
  }

  /** Stops listening when the autocomplete panel closes. */
  onJoinPanelClosed(): void {
    this.detachJoinPanelScroll();
  }

  private readonly onJoinPanelScroll = (): void => {
    const panel = this.joinPanelEl;
    if (panel === undefined) return;
    if (this.directoryCursor === undefined || this.directoryLoadingMore()) return;
    const remaining = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    if (remaining <= DIRECTORY_SCROLL_THRESHOLD_PX) {
      void this.loadMoreDirectory();
    }
  };

  private detachJoinPanelScroll(): void {
    this.joinPanelEl?.removeEventListener('scroll', this.onJoinPanelScroll);
    this.joinPanelEl = undefined;
  }

  /**
   * Loads the first page of directory hits for the typed query.
   *
   * @param query - The search text from the join combo box.
   */
  private async searchDirectory(query: string): Promise<void> {
    const seq = ++this.searchSeq;
    this.directoryQuery = query;
    this.directoryCursor = undefined;
    this.directoryLoadingMore.set(false);
    try {
      const page = await this.api.searchTeams(query, { limit: DIRECTORY_PAGE_SIZE });
      if (seq !== this.searchSeq) return;
      this.directoryHits.set(page.teams);
      this.directoryCursor = page.cursor;
    } catch {
      if (seq !== this.searchSeq) return;
      this.directoryHits.set([]);
      this.directoryCursor = undefined;
    }
  }

  /**
   * Appends the next directory page when the panel is scrolled to the bottom.
   */
  private async loadMoreDirectory(): Promise<void> {
    const cursor = this.directoryCursor;
    if (cursor === undefined || this.directoryLoadingMore()) return;
    const seq = this.searchSeq;
    this.directoryLoadingMore.set(true);
    try {
      const page = await this.api.searchTeams(this.directoryQuery, {
        limit: DIRECTORY_PAGE_SIZE,
        cursor,
      });
      if (seq !== this.searchSeq) return;
      this.directoryHits.update((hits) => {
        const seen = new Set(hits.map((hit) => hit.teamId));
        return [...hits, ...page.teams.filter((team) => !seen.has(team.teamId))];
      });
      this.directoryCursor = page.cursor;
    } catch {
      // Keep the rows already shown; the user can scroll again to retry.
    } finally {
      if (seq === this.searchSeq) this.directoryLoadingMore.set(false);
    }
  }

  /**
   * Selects join or create, or clears the choice when that option is already active.
   *
   * @param next - The option the user clicked.
   */
  selectMode(next: 'join' | 'create'): void {
    this.mode.update((current) => (current === next ? undefined : next));
  }

  private async load(): Promise<void> {
    const teams = await this.api.listTeams();
    this.teams.set(teams);
    void this.loadPendingApprovals(teams);
    await this.api.restoreTeamId();
    const selected =
      teams.find((team) => team.teamId === this.api.getTeamId()) ?? teams[0];
    if (selected !== undefined) this.api.setTeamId(selected.teamId);
    void this.teamBrand.apply(selected?.theme);
    for (const team of teams) void this.teamBrand.rememberLogo(team.theme?.logoKey);
  }

  /**
   * Marks teams that have pending join requests when the caller's role can approve them.
   *
   * @param teams - The teams just loaded for this page.
   */
  private async loadPendingApprovals(teams: readonly TeamSummary[]): Promise<void> {
    const seq = ++this.approvalSeq;
    const flagged = await Promise.all(
      teams.map(async (team) => {
        try {
          const matrix = await this.api.getPermissions(team.teamId);
          const permissions =
            matrix.roles.find((row) => row.role === team.role)?.permissions ?? [];
          if (!permissions.includes('approve_join_requests')) return false;
          const requests = await this.api.listJoinRequests(team.teamId);
          return requests.length > 0;
        } catch {
          return false;
        }
      }),
    );
    if (seq !== this.approvalSeq) return;
    this.pendingApprovalTeamIds.set(
      new Set(teams.filter((_, index) => flagged[index]).map((team) => team.teamId)),
    );
  }

  async requestJoin(): Promise<void> {
    const team = this.selectedJoin();
    if (team === undefined) return;
    this.error.set(undefined);
    this.joinMessage.set(undefined);
    try {
      await this.api.requestJoin(team.teamId);
      this.joinMessage.set(`Join request sent to ${team.name}. An admin must approve it.`);
      this.joinControl.setValue('', { emitEvent: false });
      this.selectedJoin.set(undefined);
      void this.searchDirectory('');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'join_failed');
    }
  }

  async create(): Promise<void> {
    if (this.form.invalid) return;
    this.error.set(undefined);
    try {
      const team = await this.api.createTeam(this.form.getRawValue());
      this.api.setTeamId(team.teamId);
      await this.load();
      this.form.reset({ name: '', timeZone: 'America/New_York' });
      await this.router.navigateByUrl('/schedule');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'create_failed');
    }
  }

  /** Opens the accept page for a pasted invite code or shared link. */
  async openInvite(): Promise<void> {
    const code = inviteCodeFromInput(this.inviteCode.value);
    if (code.length === 0) return;
    await this.router.navigate(['/invite', code]);
  }

  async logout(): Promise<void> {
    await this.api.logout();
    await this.teamBrand.apply(undefined);
    await this.router.navigateByUrl('/login');
  }
}

/** Image types accepted for a team logo. */
const LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Largest logo the admin page will upload. */
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Whether two stored themes are the same, treating a cleared theme as absent.
 *
 * @param next - The theme the form would save, or `null` to clear it.
 * @param loaded - The theme last loaded from the server.
 * @returns True when the update can omit `theme`.
 */
const sameTheme = (next: TeamTheme | null, loaded: TeamTheme | undefined): boolean => {
  const current = next ?? undefined;
  if (current === undefined && loaded === undefined) return true;
  if (current === undefined || loaded === undefined) return false;
  return (
    current.primary === loaded.primary &&
    current.secondary === loaded.secondary &&
    current.accent === loaded.accent &&
    current.logoKey === loaded.logoKey
  );
};

@Component({
  selector: 'app-team-admin',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatAutocompleteModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './team-admin.html',
})
export class TeamAdminPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  readonly teamBrand = inject(TeamBrand);

  readonly teamName = signal('Team');
  readonly members = signal<TeamMember[]>([]);
  readonly rosterError = signal<string | undefined>(undefined);
  readonly roles = signal<RolePermissions[]>([]);
  readonly invites = signal<TeamInvite[]>([]);
  readonly joinRequests = signal<JoinRequest[]>([]);
  readonly canManage = signal(false);
  readonly canInvite = signal(false);
  readonly canApprove = signal(false);
  readonly busyRequestId = signal<string | undefined>(undefined);
  readonly joinError = signal<string | undefined>(undefined);
  private readonly joinRoles = signal<Record<string, TeamRole>>({});
  readonly creatingInvite = signal(false);
  readonly inviteError = signal<string | undefined>(undefined);
  readonly copiedCode = signal<string | undefined>(undefined);
  readonly inviteRoles = TEAM_ROLES;
  readonly roleLabel = roleLabel;
  readonly inviteRole = new FormControl<TeamRole>('player', { nonNullable: true });
  readonly error = signal<string | undefined>(undefined);
  readonly settingsError = signal<string | undefined>(undefined);
  readonly settingsSaved = signal(false);
  readonly uploadingLogo = signal(false);
  readonly logoPreview = signal<string | undefined>(undefined);
  readonly permissions = TEAM_PERMISSIONS;
  readonly settings = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    timeZone: ['', [Validators.required, Validators.maxLength(64), timeZoneValidator]],
    location: ['', Validators.maxLength(200)],
    useColors: [false],
    primary: ['#0d9488'],
    secondary: ['#1e40af'],
    accent: ['#d97706'],
    logoKey: [''],
  });
  private readonly timeZoneQuery = toSignal(this.settings.controls.timeZone.valueChanges, {
    initialValue: '',
  });
  readonly timeZoneOptions = computed(() => filterTimeZones(this.timeZoneQuery()));
  private teamId = '';
  private loadedTheme: TeamTheme | undefined;

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId') ?? '';
    this.settings.valueChanges.subscribe(() => {
      this.settingsSaved.set(false);
      void this.teamBrand.apply(this.currentTheme() ?? undefined);
    });
    void this.load();
  }

  /** Restores the selected team's colors when this page was previewing a different team. */
  ngOnDestroy(): void {
    const selected = this.api.getTeamId?.();
    if (selected === undefined || selected === this.teamId) return;
    void this.api.getTeam(selected).then((team) => this.teamBrand.apply(team.theme));
  }

  private async load(): Promise<void> {
    const [team, result] = await Promise.all([
      this.api.getTeam(this.teamId),
      this.api.getPermissions(this.teamId),
    ]);
    this.teamName.set(team.name);
    this.settings.reset(this.settingsValue(team), { emitEvent: false });
    this.loadedTheme = team.theme;
    void this.teamBrand.apply(team.theme);
    void this.showLogo(team.theme?.logoKey);
    this.roles.set(result.roles);
    const caller = result.roles.find((row) => row.role === team.role);
    const permissions = caller?.permissions ?? [];
    this.canManage.set(permissions.includes('manage_permissions'));
    this.canInvite.set(permissions.includes('invite_members'));
    this.canApprove.set(permissions.includes('approve_join_requests'));
    try {
      this.members.set(await this.loadMembers());
      this.rosterError.set(undefined);
    } catch {
      this.rosterError.set('Could not load the roster.');
    }
    if (this.canInvite()) {
      try {
        this.invites.set(await this.loadInvites());
      } catch (err) {
        this.inviteError.set(err instanceof Error ? err.message : 'invite_failed');
      }
    }
    if (this.canApprove()) {
      try {
        this.joinRequests.set(await this.loadJoinRequests());
      } catch (err) {
        this.joinError.set(joinRequestMessage(err));
      }
    }
  }

  /**
   * Role chosen for a pending request. Defaults to player.
   *
   * @param requestId - The pending request.
   * @returns The role the approve action will assign.
   */
  joinRole(requestId: string): TeamRole {
    return this.joinRoles()[requestId] ?? 'player';
  }

  /**
   * Remembers the role selected for a pending request.
   *
   * @param requestId - The pending request.
   * @param role - The role to assign on approve.
   */
  setJoinRole(requestId: string, role: TeamRole): void {
    this.joinRoles.update((current) => ({ ...current, [requestId]: role }));
  }

  /**
   * Whether a minor cannot be given this role.
   *
   * @param request - The pending request.
   * @param role - The role under consideration.
   * @returns `true` when the option should be disabled.
   */
  roleBlocked(request: JoinRequest, role: TeamRole): boolean {
    if (request.accountKind !== 'minor') return false;
    if (role === 'team_admin') return true;
    return this.roles().some(
      (row) => row.role === role && row.permissions.includes('manage_permissions'),
    );
  }

  /**
   * Approves a join request with the role selected on that row.
   *
   * @param request - The pending request.
   */
  async approveJoin(request: JoinRequest): Promise<void> {
    if (this.busyRequestId() !== undefined) return;
    this.joinError.set(undefined);
    this.busyRequestId.set(request.requestId);
    try {
      await this.api.approveJoinRequest(
        this.teamId,
        request.requestId,
        this.joinRole(request.requestId),
      );
      this.removeJoinRequest(request.requestId);
    } catch (err) {
      this.joinError.set(joinRequestMessage(err));
    } finally {
      this.busyRequestId.set(undefined);
    }
  }

  /**
   * Declines a join request and removes it from the list.
   *
   * @param request - The pending request.
   */
  async declineJoin(request: JoinRequest): Promise<void> {
    if (this.busyRequestId() !== undefined) return;
    this.joinError.set(undefined);
    this.busyRequestId.set(request.requestId);
    try {
      await this.api.rejectJoinRequest(this.teamId, request.requestId);
      this.removeJoinRequest(request.requestId);
    } catch (err) {
      this.joinError.set(joinRequestMessage(err));
    } finally {
      this.busyRequestId.set(undefined);
    }
  }

  /** Drops a request from the pending list after it is approved or declined. */
  private removeJoinRequest(requestId: string): void {
    this.joinRequests.update((rows) => rows.filter((row) => row.requestId !== requestId));
  }

  /** Loads pending join requests, newest first. */
  private async loadJoinRequests(): Promise<JoinRequest[]> {
    const requests = await this.api.listJoinRequests(this.teamId);
    return [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Creates a shareable invite for the selected role and refreshes the list.
   */
  async createInviteLink(): Promise<void> {
    if (!this.canInvite() || this.creatingInvite()) return;
    this.inviteError.set(undefined);
    this.creatingInvite.set(true);
    try {
      await this.api.createInvite(this.teamId, this.inviteRole.value);
      this.invites.set(await this.loadInvites());
    } catch {
      this.inviteError.set('Could not create the invite.');
    } finally {
      this.creatingInvite.set(false);
    }
  }

  /**
   * Copies the accept URL for an invite code.
   *
   * @param code - The invite code.
   */
  async copyInviteLink(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteLink(code));
      this.copiedCode.set(code);
      this.inviteError.set(undefined);
    } catch {
      this.inviteError.set('Could not copy the link. Select it and copy it manually.');
    }
  }

  /**
   * Absolute accept URL for a code.
   *
   * @param code - The invite code.
   * @returns The link to share.
   */
  inviteLink(code: string): string {
    return `${location.origin}/invite/${code}`;
  }

  /** Loads the roster, team admins first, then by name. */
  private async loadMembers(): Promise<TeamMember[]> {
    const members = await this.api.listMembers(this.teamId);
    return [...members].sort((a, b) => {
      const byRole = TEAM_ROLES.indexOf(a.role) - TEAM_ROLES.indexOf(b.role);
      if (byRole !== 0) return byRole;
      return (a.displayName ?? a.email ?? '').localeCompare(b.displayName ?? b.email ?? '');
    });
  }

  /** Loads invites, newest first. */
  private async loadInvites(): Promise<TeamInvite[]> {
    const invites = await this.api.listInvites(this.teamId);
    return [...invites].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveSettings(): Promise<void> {
    if (this.settings.invalid) return;
    const raw = this.settings.getRawValue();
    const name = raw.name.trim();
    const timeZone = raw.timeZone.trim();
    const location = raw.location.trim();
    if (name.length === 0 || timeZone.length === 0) {
      this.settingsError.set('Name and time zone are required.');
      return;
    }
    this.settingsError.set(undefined);
    this.settingsSaved.set(false);
    try {
      const team = await this.api.updateTeam(this.teamId, {
        name,
        timeZone,
        location: location.length === 0 ? null : location,
        ...this.themeChange(),
      });
      this.loadedTheme = team.theme;
      this.settings.reset(this.settingsValue(team), { emitEvent: false });
      void this.teamBrand.apply(team.theme);
      void this.showLogo(team.theme?.logoKey);
      this.settingsSaved.set(true);
    } catch (err) {
      this.settingsError.set(err instanceof Error ? err.message : 'save_failed');
    }
  }

  /**
   * Uploads a logo and keeps its object key for the next settings save.
   *
   * @param event - The file input change event.
   */
  async onLogo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    if (!LOGO_TYPES.has(file.type)) {
      this.settingsError.set('Choose a JPEG, PNG, WebP, or GIF.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      this.settingsError.set('Choose a logo smaller than 5 MB.');
      return;
    }

    this.uploadingLogo.set(true);
    this.settingsError.set(undefined);
    try {
      const presign = await this.api.presignUpload(file.type, file.size);
      const uploaded = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!uploaded.ok) throw new Error('upload_failed');
      this.settings.controls.logoKey.setValue(presign.objectKey);
      this.logoPreview.set(URL.createObjectURL(file));
    } catch {
      this.settingsError.set('Could not upload that logo.');
    } finally {
      this.uploadingLogo.set(false);
    }
  }

  /** Drops the logo from the next settings save. */
  removeLogo(): void {
    this.settings.controls.logoKey.setValue('');
    this.logoPreview.set(undefined);
  }

  /**
   * Form value for a team, including theme controls.
   *
   * @param team - The team loaded from the API.
   * @returns Values for {@link settings}.
   */
  private settingsValue(team: TeamSummary): {
    name: string;
    timeZone: string;
    location: string;
    useColors: boolean;
    primary: string;
    secondary: string;
    accent: string;
    logoKey: string;
  } {
    const colors =
      team.theme?.primary !== undefined ||
      team.theme?.secondary !== undefined ||
      team.theme?.accent !== undefined;
    return {
      name: team.name,
      timeZone: team.timeZone,
      location: team.location ?? '',
      useColors: colors,
      primary: team.theme?.primary ?? '#0d9488',
      secondary: team.theme?.secondary ?? '#1e40af',
      accent: team.theme?.accent ?? '#d97706',
      logoKey: team.theme?.logoKey ?? '',
    };
  }

  /**
   * Theme body when it differs from the last loaded team.
   *
   * @returns `{ theme }` to send, or an empty object when the theme is unchanged.
   */
  private themeChange(): { theme: TeamTheme | null } | Record<string, never> {
    const next = this.currentTheme();
    if (sameTheme(next, this.loadedTheme)) return {};
    return { theme: next };
  }

  /** Theme the form would store. `null` clears colors and the logo. */
  private currentTheme(): TeamTheme | null {
    const raw = this.settings.getRawValue();
    const logoKey = raw.logoKey.trim();
    if (!raw.useColors && logoKey.length === 0) return null;
    return {
      ...(raw.useColors
        ? { primary: raw.primary, secondary: raw.secondary, accent: raw.accent }
        : {}),
      ...(logoKey.length > 0 ? { logoKey } : {}),
    };
  }

  /**
   * Shows a saved logo in the preview.
   *
   * @param logoKey - The stored object key.
   */
  private async showLogo(logoKey: string | undefined): Promise<void> {
    if (logoKey === undefined || logoKey.length === 0) {
      this.logoPreview.set(undefined);
      return;
    }
    await this.teamBrand.rememberLogo(logoKey);
    this.logoPreview.set(this.teamBrand.logoFor(logoKey));
  }

  has(row: RolePermissions, permission: TeamPermission): boolean {
    return row.permissions.includes(permission);
  }

  toggle(role: TeamRole | string, permission: TeamPermission, checked: boolean): void {
    this.roles.update((rows) =>
      rows.map((row) => {
        if (row.role !== role) return row;
        const set = new Set<TeamPermission>(row.permissions);
        if (checked) set.add(permission);
        else set.delete(permission);
        if (role === 'team_admin') set.add('manage_permissions');
        return { role: row.role, permissions: [...set] };
      }),
    );
  }

  async save(): Promise<void> {
    try {
      const result = await this.api.putPermissions(this.teamId, this.roles());
      this.roles.set(result.roles);
      this.error.set(undefined);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'save_failed');
    }
  }
}
