import { createSpyObj, type SpyObj } from '../../testing/spy';
import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SchedulePageComponent } from './schedule';
import type { ScheduleOccurrence, TeamSummary } from '@gameplan/types';
import { ActiveTeamService } from '../core/active-team.service';
import { ApiClientService } from '../core/api-client.service';
import { LiveSocketService } from '../core/live-socket.service';
import { ModalService } from '../core/modal.service';
import { Capacitor } from '@capacitor/core';
import * as placeSearch from './place-search';

describe('SchedulePageComponent', () => {
  let fixture: ComponentFixture<SchedulePageComponent>;
  let api: SpyObj<ApiClientService>;
  let modal: SpyObj<ModalService>;
  let liveHandler: ((event: unknown) => void) | undefined;
  let teams: ReturnType<typeof signal<TeamSummary[]>>;
  let teamId: ReturnType<typeof signal<string | undefined>>;
  let activeTeam: {
    teams: typeof teams;
    teamId: ReturnType<typeof computed>;
    active: ReturnType<typeof computed>;
    refresh: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    teams = signal<TeamSummary[]>([]);
    teamId = signal<string | undefined>(undefined);
    activeTeam = {
      teams,
      teamId: computed(() => teamId()),
      active: computed(() => teams().find((team) => team.teamId === teamId())),
      refresh: vi.fn().mockResolvedValue(undefined),
    };

    api = createSpyObj<ApiClientService>('ApiClientService', [
      'getSchedule',
      'getPermissions',
      'createEvent',
      'putRsvp',
    ]);
    api.getPermissions.mockResolvedValue({ roles: [] });
    Object.defineProperty(api, 'user', { get: () => ({ userId: 'user-1' }), configurable: true });
    modal = createSpyObj<ModalService>('ModalService', ['open']);
    modal.open.mockResolvedValue(false);

    await TestBed.configureTestingModule({
      imports: [SchedulePageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: api },
        { provide: ActiveTeamService, useValue: activeTeam },
        { provide: ModalService, useValue: modal },
        {
          provide: LiveSocketService,
          useValue: {
            subscribe: (handler: (event: unknown) => void) => {
              liveHandler = handler;
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SchedulePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('prompts the user to join a team when none exist', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Join or create a team');
  });

  it('shows a month calendar and the add-event types', async () => {
    const team: TeamSummary = {
      teamId: 't1',
      name: 'Seacoast',
      timeZone: 'America/New_York',
      role: 'team_admin',
    };
    const occurrence: ScheduleOccurrence = {
      eventId: 'e1',
      eventType: 'practice',
      title: 'Evening practice',
      startsAt: new Date().toISOString(),
      rsvps: [],
    };
    teams.set([team]);
    teamId.set('t1');
    api.getSchedule.mockResolvedValue({
      teamId: 't1',
      from: occurrence.startsAt,
      to: occurrence.startsAt,
      occurrences: [occurrence],
    });
    api.getPermissions.mockResolvedValue({
      roles: [
        {
          role: 'team_admin',
          permissions: ['manage_events'],
        },
      ],
    });

    fixture = TestBed.createComponent(SchedulePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Sun');
    expect(text).toContain('Evening practice');
    expect(text).toContain('Add event');

    const add = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Add event'));
    add?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const form = document.body.textContent ?? '';
    expect(form).toContain('Practice');
    expect(form).toContain('Game');
    expect(form).toContain('Meeting');
    expect(form).toContain('Other');
    document.querySelector<HTMLButtonElement>('app-modal [aria-label="Close"]')?.click();
  });

  it('loads schedule and permissions once per team, not in a loop after events arrive', async () => {
    const team: TeamSummary = {
      teamId: 't1',
      name: 'Seacoast',
      timeZone: 'America/New_York',
      role: 'team_admin',
    };
    const occurrence: ScheduleOccurrence = {
      eventId: 'e1',
      eventType: 'practice',
      title: 'Evening practice',
      startsAt: new Date().toISOString(),
      rsvps: [],
    };
    teams.set([team]);
    teamId.set('t1');
    api.getSchedule.mockResolvedValue({
      teamId: 't1',
      from: occurrence.startsAt,
      to: occurrence.startsAt,
      occurrences: [occurrence],
    });
    api.getPermissions.mockResolvedValue({
      roles: [{ role: 'team_admin', permissions: ['manage_events'] }],
    });

    fixture = TestBed.createComponent(SchedulePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(api.getSchedule).toHaveBeenCalledTimes(1);
    expect(api.getPermissions).toHaveBeenCalledTimes(1);

    // Extra change detection must not re-fetch (the old effect tracked occurrences).
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(api.getSchedule).toHaveBeenCalledTimes(1);
    expect(api.getPermissions).toHaveBeenCalledTimes(1);

    teams.set([
      team,
      { teamId: 't2', name: 'Other', timeZone: 'UTC', role: 'player' },
    ]);
    teamId.set('t2');
    api.getSchedule.mockResolvedValue({
      teamId: 't2',
      from: occurrence.startsAt,
      to: occurrence.startsAt,
      occurrences: [],
    });
    api.getPermissions.mockResolvedValue({
      roles: [{ role: 'player', permissions: [] }],
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(api.getSchedule).toHaveBeenCalledTimes(2);
    expect(api.getPermissions).toHaveBeenCalledTimes(2);
  });

  it('covers calendar helpers, RSVP, maps, and live reloads', async () => {
    const team: TeamSummary = {
      teamId: 't1',
      name: 'Seacoast',
      timeZone: 'America/New_York',
      role: 'player',
    };
    const occurrence: ScheduleOccurrence = {
      eventId: 'e1',
      eventType: 'practice',
      title: 'Evening practice',
      startsAt: '2026-10-05T22:00:00.000Z',
      location: 'Gym',
      latitude: 42.36,
      longitude: -71.06,
      rsvps: [{ userId: 'user-1', status: 'going' }],
    };
    teams.set([team]);
    teamId.set('t1');
    api.getSchedule.mockResolvedValue({
      teamId: 't1',
      from: occurrence.startsAt,
      to: occurrence.startsAt,
      occurrences: [occurrence],
    });
    api.getPermissions.mockResolvedValue({ roles: [{ role: 'player', permissions: [] }] });

    fixture = TestBed.createComponent(SchedulePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    expect(component.monthLabel().length).toBeGreaterThan(0);
    expect(component.selectedLabel().length).toBeGreaterThan(0);
    expect(component.timeLabel(occurrence.startsAt)).toContain(':');
    expect(component.eventLabel('unknown')).toBe('unknown');
    expect(component.myRsvp(occurrence)).toBe('going');
    component.selectDay(component.todayKey());

    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    expect(component.primaryMapsProvider()).toBe('apple');
    expect(component.showSecondaryMapsLink()).toBe(true);
    expect(component.secondaryMapsProvider()).toBe('google');
    expect(component.mapsProviderLabel('google')).toBe('Google Maps');

    const openMaps = vi.spyOn(placeSearch, 'openPlaceInMaps').mockImplementation(() => undefined);
    component.openMaps(occurrence, 'google');
    expect(openMaps).toHaveBeenCalled();
    component.openMaps({ ...occurrence, location: '' }, 'google');
    expect(openMaps).toHaveBeenCalledTimes(1);

    api.putRsvp.mockResolvedValue(undefined);
    await component.rsvp(occurrence, 'maybe');
    expect(api.putRsvp).toHaveBeenCalled();

    api.putRsvp.mockRejectedValue(new Error('rsvp_failed'));
    await component.rsvp(occurrence, 'not_going');
    expect(component.error()).toBe('rsvp_failed');

    modal.open.mockResolvedValue(true);
    await component.startAdd();
    expect(api.getSchedule.mock.calls.length).toBeGreaterThan(1);

    liveHandler?.({ type: 'schedule_changed', teamId: 't1' });
    await fixture.whenStable();
    expect(api.getSchedule.mock.calls.length).toBeGreaterThan(2);

    await component.shiftMonth(1);
    await component.showToday();
    expect(component.viewingCurrentMonth()).toBeTypeOf('boolean');
  });

  it('surfaces schedule load and permission failures', async () => {
    teams.set([
      { teamId: 't1', name: 'Seacoast', timeZone: 'America/New_York', role: 'player' },
    ]);
    teamId.set('t1');
    api.getSchedule.mockRejectedValue(new Error('load_failed'));
    api.getPermissions.mockRejectedValue(new Error('denied'));

    fixture = TestBed.createComponent(SchedulePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.error()).toBe('load_failed');
    expect(fixture.componentInstance.canManage()).toBe(false);
  });

  it('covers UTC fallback, RSVP defaults, and Android maps labels', async () => {
    teams.set([{ teamId: 't1', name: 'Seacoast', timeZone: 'America/New_York', role: 'player' }]);
    teamId.set('t1');
    Object.defineProperty(api, 'user', { configurable: true, get: () => undefined });
    api.getSchedule.mockResolvedValue({
      teamId: 't1',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T00:00:00.000Z',
      occurrences: [
        {
          eventId: 'e2',
          eventType: 'game',
          title: 'Away',
          startsAt: '2026-10-05T22:00:00.000Z',
          location: 'Field',
          rsvps: [],
        },
      ],
    });
    api.getPermissions.mockResolvedValue({
      roles: [{ role: 'coach', permissions: ['manage_events'] }],
    });
    api.putRsvp.mockRejectedValue('nope');

    fixture = TestBed.createComponent(SchedulePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;

    expect(component.selectedLabel()).toBeTruthy();
    component.selectedKey.set('');
    expect(component.selectedLabel()).toBe('');

    teams.set([]);
    expect(component.timeZone()).toBe('UTC');
    expect(component.myRsvp(component.occurrences()[0]!)).toBe('none');
    await component.rsvp(component.occurrences()[0]!, 'going');
    expect(component.error()).toBe('rsvp_failed');

    teamId.set(undefined);
    await component.rsvp(component.occurrences()[0]!, 'going');
    await component.startAdd();
    await (component as unknown as { loadSchedule: () => Promise<void> }).loadSchedule();
    api.getSchedule.mockRejectedValue('offline');
    teamId.set('t1');
    teams.set([{ teamId: 't1', name: 'Seacoast', timeZone: 'America/New_York', role: 'player' }]);
    await (component as unknown as { loadSchedule: () => Promise<void> }).loadSchedule();
    expect(component.error()).toBe('load_failed');

    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    expect(component.primaryMapsProvider()).toBe('google');
    expect(component.showSecondaryMapsLink()).toBe(false);
    expect(component.secondaryMapsProvider()).toBe('apple');
    expect(component.mapsProviderLabel('apple')).toBe('Apple Maps');

    const openMaps = vi.spyOn(placeSearch, 'openPlaceInMaps').mockImplementation(() => undefined);
    component.openMaps(
      {
        eventId: 'e2',
        eventType: 'game',
        title: 'Away',
        startsAt: '2026-10-05T22:00:00.000Z',
        location: 'Field',
        rsvps: [],
      },
      'apple',
    );
    expect(openMaps).toHaveBeenCalled();

    await component.shiftMonth(1);
    const viewing = component.month();
    const today = component.todayKey();
    if (!today.startsWith(`${viewing.year}-${String(viewing.month).padStart(2, '0')}`)) {
      expect(component.selectedKey().endsWith('-01')).toBe(true);
    }
  });

  it('ignores actions and labels while no team is selected', async () => {
    const component = fixture.componentInstance;
    expect(component.selectedLabel()).toBe('');
    component.selectDay('2000-01-01');
    expect(component.selectedEvents()).toEqual([]);

    await component.startAdd();
    expect(modal.open).not.toHaveBeenCalled();
    await component.rsvp(
      { eventId: 'e1', eventType: 'practice', title: 'P', startsAt: '2026-10-05T22:00:00.000Z', rsvps: [] },
      'going',
    );
    expect(api.putRsvp).not.toHaveBeenCalled();
    await component.showToday();
    await component.shiftMonth(0);
    expect(api.getSchedule).not.toHaveBeenCalled();
    // Moving to the current month selects today.
    expect(component.selectedKey()).toBe(component.todayKey());
  });

  it('reports a generic error when the schedule request rejects with a non-error', async () => {
    teams.set([{ teamId: 't1', name: 'Seacoast', timeZone: 'America/New_York', role: 'player' }]);
    teamId.set('t1');
    api.getSchedule.mockRejectedValue('boom');

    fixture = TestBed.createComponent(SchedulePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.error()).toBe('load_failed');
  });

  it('disables manage when the active team has no role', async () => {
    teams.set([{ teamId: 't1', name: 'Seacoast', timeZone: 'America/New_York', role: 'player' }]);
    teamId.set('missing');
    api.getSchedule.mockResolvedValue({
      teamId: 'missing',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T00:00:00.000Z',
      occurrences: [],
    });

    fixture = TestBed.createComponent(SchedulePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.canManage()).toBe(false);
    expect(api.getPermissions).not.toHaveBeenCalled();
  });
});
