/**
 * Schedule home: a month calendar, the selected day's events, and RSVP.
 */

import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Capacitor } from '@capacitor/core';
import { RouterLink } from '@angular/router';
import {
  EVENT_TYPES,
  type RsvpStatus,
  type ScheduleOccurrence,
} from '@gameplan/types';
import { ActiveTeamService } from '../core/active-team.service';
import { ApiClientService } from '../core/api-client.service';
import { LiveSocketService } from '../core/live-socket.service';
import { ModalService } from '../core/modal.service';
import { AddEventFormComponent, eventTypeLabel } from './add-event-form';
import { openPlaceInMaps, type MapsProvider } from './place-search';
import {
  WEEKDAY_LABELS,
  buildMonthGrid,
  clockLabel,
  dayKeyInZone,
  dayTitle,
  monthTitle,
  shiftCalendarMonth,
  wallTimeToIso,
  type CalendarMonth,
} from './schedule-calendar';

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [MatButtonModule, RouterLink],
  templateUrl: './schedule.html',
})
export class SchedulePageComponent implements OnInit {
  private readonly api = inject(ApiClientService);
  private readonly activeTeam = inject(ActiveTeamService);
  private readonly live = inject(LiveSocketService);
  private readonly modal = inject(ModalService);

  readonly weekdayLabels = WEEKDAY_LABELS;
  readonly eventTypes = EVENT_TYPES;
  readonly teams = this.activeTeam.teams;
  readonly teamId = this.activeTeam.teamId;
  readonly occurrences = signal<ScheduleOccurrence[]>([]);
  readonly month = signal<CalendarMonth>({ year: 2026, month: 1 });
  readonly selectedKey = signal('');
  readonly canManage = signal(false);
  readonly error = signal<string | undefined>(undefined);

  readonly timeZone = computed(
    () => this.activeTeam.active()?.timeZone ?? 'UTC',
  );

  readonly cells = computed(() => {
    const zone = this.timeZone();
    const { year, month } = this.month();
    const byDay = new Map<string, ScheduleOccurrence[]>();
    for (const item of this.occurrences()) {
      const key = dayKeyInZone(new Date(item.startsAt), zone);
      const list = byDay.get(key) ?? [];
      list.push(item);
      byDay.set(key, list);
    }
    return buildMonthGrid(year, month, zone).map((cell) => ({
      ...cell,
      events: byDay.get(cell.key) ?? [],
    }));
  });

  readonly selectedEvents = computed(
    () =>
      this.cells().find((cell) => cell.key === this.selectedKey())?.events ??
      [],
  );

  constructor() {
    effect(() => {
      const id = this.teamId();
      // Only `teamId` should re-run this effect. Loading reads month/occurrences
      // and then writes them, which would loop if those reads were tracked.
      untracked(() => {
        if (id === undefined) {
          this.occurrences.set([]);
          this.canManage.set(false);
          return;
        }
        this.focusToday();
        void Promise.all([this.loadSchedule(), this.loadPermissions()]);
      });
    });
  }

  ngOnInit(): void {
    void this.activeTeam.refresh();
    this.live.subscribe((event) => {
      if (event.type === 'schedule_changed' && event.teamId === this.teamId()) {
        void this.loadSchedule();
      }
    });
  }

  /** Heading for the visible month. */
  monthLabel(): string {
    return monthTitle(this.month(), this.timeZone());
  }

  /** Heading for the selected day. */
  selectedLabel(): string {
    const key = this.selectedKey();
    if (key.length === 0) return '';
    return dayTitle(key, this.timeZone());
  }

  /**
   * Clock time of an instant in the team zone.
   *
   * @param iso - A UTC ISO instant.
   * @returns A short clock time.
   */
  timeLabel(iso: string): string {
    return clockLabel(iso, this.timeZone());
  }

  /**
   * Display name for an event type.
   *
   * @param eventType - The stored event type.
   * @returns The label shown on the type picker and event cards.
   */
  eventLabel(eventType: string): string {
    return eventTypeLabel(eventType);
  }

  /** Wall date of today in the team zone. */
  todayKey(): string {
    return dayKeyInZone(new Date(), this.timeZone());
  }

  /** True when the visible month contains today in the team zone. */
  viewingCurrentMonth(): boolean {
    const today = dayKeyInZone(new Date(), this.timeZone()).slice(0, 7);
    const { year, month } = this.month();
    return today === `${year}-${String(month).padStart(2, '0')}`;
  }

  /**
   * Moves the visible month and keeps a selected day inside it.
   *
   * @param delta - Months to add. Negative moves backward.
   */
  async shiftMonth(delta: number): Promise<void> {
    const next = shiftCalendarMonth(this.month(), delta);
    this.month.set(next);
    const today = this.todayKey();
    const monthKey = `${next.year}-${String(next.month).padStart(2, '0')}`;
    if (today.startsWith(monthKey)) this.selectedKey.set(today);
    else if (!this.selectedKey().startsWith(monthKey))
      this.selectedKey.set(`${monthKey}-01`);
    await this.loadSchedule();
  }

  /** Jumps the calendar back to today in the team zone. */
  async showToday(): Promise<void> {
    this.focusToday();
    await this.loadSchedule();
  }

  /**
   * Selects a day in the grid.
   *
   * @param key - The `YYYY-MM-DD` wall date.
   */
  selectDay(key: string): void {
    this.selectedKey.set(key);
  }

  /** Opens the add-event form in a modal for the selected day. */
  async startAdd(): Promise<void> {
    const teamId = this.teamId();
    const key = this.selectedKey();
    if (teamId === undefined || key.length === 0) return;
    const created = await this.modal.open<boolean>(AddEventFormComponent, {
      title: 'Add event',
      inputs: {
        teamId,
        dayKey: key,
        timeZone: this.timeZone(),
        dayLabel: this.selectedLabel(),
      },
    });
    if (created) await this.loadSchedule();
  }

  /**
   * Upserts an RSVP for one occurrence.
   *
   * @param item - The occurrence row.
   * @param status - going / maybe / not_going.
   */
  async rsvp(item: ScheduleOccurrence, status: RsvpStatus): Promise<void> {
    const teamId = this.teamId();
    if (teamId === undefined) return;
    try {
      await this.api.putRsvp(teamId, {
        eventId: item.eventId,
        occurrenceStartsAt: item.startsAt,
        status,
      });
      await this.loadSchedule();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'rsvp_failed');
    }
  }

  /**
   * Returns the caller's RSVP status for an occurrence.
   *
   * @param item - The occurrence row.
   * @returns Status string, or `none`.
   */
  myRsvp(item: ScheduleOccurrence): string {
    const userId = this.api.user?.userId;
    if (userId === undefined) return 'none';
    return (
      item.rsvps.find((entry) => entry.userId === userId)?.status ?? 'none'
    );
  }

  /**
   * Preferred maps app for the primary open action on this platform.
   *
   * @returns Apple Maps on iOS, otherwise Google Maps.
   */
  primaryMapsProvider(): MapsProvider {
    return Capacitor.getPlatform() === 'ios' ? 'apple' : 'google';
  }

  /**
   * Whether the secondary maps link should be shown.
   *
   * @returns True on iOS (Google as secondary) and on web (both links).
   */
  showSecondaryMapsLink(): boolean {
    const platform = Capacitor.getPlatform();
    return platform === 'ios' || platform === 'web';
  }

  /**
   * Secondary maps provider when both links are shown.
   *
   * @returns Google on iOS; Apple on web/Android when secondary is shown.
   */
  secondaryMapsProvider(): MapsProvider {
    return this.primaryMapsProvider() === 'apple' ? 'google' : 'apple';
  }

  /**
   * Opens the occurrence location in a maps app.
   *
   * @param item - The schedule occurrence with a location label.
   * @param provider - Apple Maps or Google Maps.
   */
  openMaps(item: ScheduleOccurrence, provider: MapsProvider): void {
    if (item.location === undefined || item.location.length === 0) return;
    openPlaceInMaps(
      {
        label: item.location,
        ...(item.latitude !== undefined ? { latitude: item.latitude } : {}),
        ...(item.longitude !== undefined ? { longitude: item.longitude } : {}),
      },
      provider,
    );
  }

  /** Label for a maps provider button. */
  mapsProviderLabel(provider: MapsProvider): string {
    return provider === 'apple' ? 'Apple Maps' : 'Google Maps';
  }

  /** Points the visible month and selection at today in the team zone. */
  private focusToday(): void {
    const key = dayKeyInZone(new Date(), this.timeZone());
    const [year, month] = key.split('-').map(Number) as [number, number];
    this.month.set({ year, month });
    this.selectedKey.set(key);
  }

  /** Loads the visible month, including days shown from the neighboring months. */
  private async loadSchedule(): Promise<void> {
    const teamId = this.teamId();
    if (teamId === undefined) return;
    const grid = this.cells();
    // A month grid always holds at least four full weeks.
    const first = grid[0]!.key;
    const last = grid.at(-1)!.key;
    const zone = this.timeZone();
    try {
      const result = await this.api.getSchedule(
        teamId,
        wallTimeToIso(zone, first, '00:00'),
        wallTimeToIso(zone, last, '23:59'),
      );
      this.occurrences.set(result.occurrences);
      this.error.set(undefined);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'load_failed');
    }
  }

  /** Shows the add control when the caller's role can manage events. */
  private async loadPermissions(): Promise<void> {
    const teamId = this.teamId();
    const role = this.teams().find((team) => team.teamId === teamId)?.role;
    if (teamId === undefined || role === undefined) {
      this.canManage.set(false);
      return;
    }
    try {
      const body = await this.api.getPermissions(teamId);
      const permissions =
        body.roles.find((entry) => entry.role === role)?.permissions ?? [];
      this.canManage.set(permissions.includes('manage_events'));
    } catch {
      this.canManage.set(false);
    }
  }
}
