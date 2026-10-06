import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { TeamAdminPageComponent } from './teams';
import { ApiClient } from '../core/api-client';

describe('TeamAdminPageComponent', () => {
  let fixture: ComponentFixture<TeamAdminPageComponent>;
  let api: jasmine.SpyObj<ApiClient>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiClient>('ApiClient', [
      'getTeam',
      'updateTeam',
      'getPermissions',
      'putPermissions',
    ]);
    api.getTeam.and.resolveTo({
      teamId: 'team-1',
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      location: 'Peoria, IL',
      role: 'team_admin',
    });
    api.getPermissions.and.resolveTo({ roles: [] });
    api.updateTeam.and.resolveTo({
      teamId: 'team-1',
      name: 'Eastside United',
      timeZone: 'America/New_York',
      location: 'Portsmouth, NH',
      role: 'team_admin',
    });

    await TestBed.configureTestingModule({
      imports: [TeamAdminPageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'team-1' } } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders team settings and the permissions screen', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Settings');
    expect(text).toContain('Team name');
    expect(text).toContain('Time zone');
    expect(text).toContain('Location');
    expect(text).toContain('Permissions');
    expect(text).toContain('Save settings');

    const value = (name: string): string =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        `input[formcontrolname="${name}"]`,
      )?.value ?? '';
    expect(value('name')).toBe('Peoria Pigs');
    expect(value('timeZone')).toBe('America/Chicago');
    expect(value('location')).toBe('Peoria, IL');
  });

  it('saves the team name, time zone, and location', async () => {
    fixture.componentInstance.settings.setValue({
      name: 'Eastside United',
      timeZone: 'America/New_York',
      location: 'Portsmouth, NH',
    });

    await fixture.componentInstance.saveSettings();
    fixture.detectChanges();

    expect(api.updateTeam).toHaveBeenCalledWith('team-1', {
      name: 'Eastside United',
      timeZone: 'America/New_York',
      location: 'Portsmouth, NH',
    });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Settings saved.');
  });

  it('rejects time zones that are not IANA names', () => {
    const timeZone = fixture.componentInstance.settings.controls.timeZone;
    timeZone.setValue('Mars/Olympus_Mons');
    expect(timeZone.hasError('timeZone')).toBeTrue();
    timeZone.setValue('Europe/London');
    expect(timeZone.valid).toBeTrue();
  });

  it('filters time zone options by typed text', () => {
    fixture.componentInstance.settings.controls.timeZone.setValue('new york');
    expect(fixture.componentInstance.timeZoneOptions()).toEqual(['America/New_York']);
  });
});
