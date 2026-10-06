/**
 * Teams list, join/create onboarding, and the team admin screen.
 */

import {
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
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
import {
  ApiClient,
  type RolePermissions,
  type TeamDirectoryHit,
  type TeamSummary,
} from '../core/api-client';
import { LiveSocket } from '../core/live-socket';
import { TEAM_PERMISSIONS, type TeamPermission, type TeamRole } from '@gameplan/types';

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
  private readonly live = inject(LiveSocket);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  @ViewChild('joinAuto') private joinAuto?: MatAutocomplete;

  readonly teams = signal<TeamSummary[]>([]);
  readonly error = signal<string | undefined>(undefined);
  readonly joinMessage = signal<string | undefined>(undefined);
  readonly mode = signal<'join' | 'create'>('join');
  readonly directoryHits = signal<TeamDirectoryHit[]>([]);
  readonly directoryLoadingMore = signal(false);
  readonly selectedJoin = signal<TeamDirectoryHit | undefined>(undefined);

  readonly joinControl = new FormControl<string | TeamDirectoryHit>('', { nonNullable: true });
  private searchSeq = 0;
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
    this.detachJoinPanelScroll();
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

  private async load(): Promise<void> {
    const teams = await this.api.listTeams();
    this.teams.set(teams);
    this.mode.set(teams.length === 0 ? 'join' : 'create');
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

  async logout(): Promise<void> {
    this.live.disconnect();
    await this.api.logout();
    await this.router.navigateByUrl('/login');
  }
}

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
  ],
  templateUrl: './team-admin.html',
})
export class TeamAdminPageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  readonly roles = signal<RolePermissions[]>([]);
  readonly error = signal<string | undefined>(undefined);
  readonly settingsError = signal<string | undefined>(undefined);
  readonly settingsSaved = signal(false);
  readonly permissions = TEAM_PERMISSIONS;
  readonly settings = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    timeZone: ['', [Validators.required, Validators.maxLength(64), timeZoneValidator]],
    location: ['', Validators.maxLength(200)],
  });
  private readonly timeZoneQuery = toSignal(this.settings.controls.timeZone.valueChanges, {
    initialValue: '',
  });
  readonly timeZoneOptions = computed(() => filterTimeZones(this.timeZoneQuery()));
  private teamId = '';

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId') ?? '';
    this.settings.valueChanges.subscribe(() => this.settingsSaved.set(false));
    void this.load();
  }

  private async load(): Promise<void> {
    const [team, result] = await Promise.all([
      this.api.getTeam(this.teamId),
      this.api.getPermissions(this.teamId),
    ]);
    this.settings.reset(
      {
        name: team.name,
        timeZone: team.timeZone,
        location: team.location ?? '',
      },
      { emitEvent: false },
    );
    this.roles.set(result.roles);
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
      });
      this.settings.reset(
        {
          name: team.name,
          timeZone: team.timeZone,
          location: team.location ?? '',
        },
        { emitEvent: false },
      );
      this.settingsSaved.set(true);
    } catch (err) {
      this.settingsError.set(err instanceof Error ? err.message : 'save_failed');
    }
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
