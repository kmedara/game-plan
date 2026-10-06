import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SchedulePageComponent } from './schedule';
import type { ScheduleOccurrence, TeamSummary } from '@gameplan/types';
import { ApiClient } from '../core/api-client';
import { LiveSocket } from '../core/live-socket';

describe('SchedulePageComponent', () => {
  let fixture: ComponentFixture<SchedulePageComponent>;
  let api: jasmine.SpyObj<ApiClient>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiClient>('ApiClient', [
      'listTeams',
      'getTeamId',
      'restoreTeamId',
      'setTeamId',
      'getSchedule',
      'getPermissions',
      'createEvent',
      'putRsvp',
    ]);
    api.getPermissions.and.resolveTo({ roles: [] });
    api.listTeams.and.resolveTo([]);
    api.getTeamId.and.returnValue(undefined);
    api.restoreTeamId.and.resolveTo(undefined);
    Object.defineProperty(api, 'user', { get: () => undefined });

    await TestBed.configureTestingModule({
      imports: [SchedulePageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        {
          provide: LiveSocket,
          useValue: jasmine.createSpyObj<LiveSocket>('LiveSocket', ['subscribe']),
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
    api.listTeams.and.resolveTo([team]);
    api.getTeamId.and.returnValue('t1');
    api.getSchedule.and.resolveTo({
      teamId: 't1',
      from: occurrence.startsAt,
      to: occurrence.startsAt,
      occurrences: [occurrence],
    });
    api.getPermissions.and.resolveTo({
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
});
