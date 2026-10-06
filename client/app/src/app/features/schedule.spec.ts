import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SchedulePageComponent } from './schedule';
import { ApiClient } from '../core/api-client';
import { LiveSocket } from '../core/live-socket';

describe('SchedulePageComponent', () => {
  let fixture: ComponentFixture<SchedulePageComponent>;
  let api: jasmine.SpyObj<ApiClient>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiClient>('ApiClient', [
      'listTeams',
      'getTeamId',
      'setTeamId',
      'getSchedule',
      'putRsvp',
    ]);
    api.listTeams.and.resolveTo([]);
    api.getTeamId.and.returnValue(undefined);
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
});
