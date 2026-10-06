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
      'listInvites',
      'createInvite',
      'listJoinRequests',
      'approveJoinRequest',
      'rejectJoinRequest',
      'listMembers',
    ]);
    api.listInvites.and.resolveTo([]);
    api.listJoinRequests.and.resolveTo([]);
    api.listMembers.and.resolveTo([
      {
        userId: 'user-1',
        role: 'team_admin',
        joinedAt: '2026-10-06T00:00:00.000Z',
        displayName: 'Morgan Seacoast',
      },
    ]);
    api.getTeam.and.resolveTo({
      teamId: 'team-1',
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      location: 'Peoria, IL',
      role: 'team_admin',
    });
    api.getPermissions.and.resolveTo({
      roles: [
        {
          role: 'team_admin',
          permissions: [
            'manage_permissions',
            'invite_members',
            'approve_join_requests',
            'assign_roles',
            'manage_events',
            'create_team_channels',
          ],
        },
      ],
    });
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
    expect(text).toContain('Roster');
    expect(text).toContain('Morgan Seacoast');
    expect(text).toContain('Team admin');
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
      useColors: false,
      primary: '#0d9488',
      secondary: '#1e40af',
      accent: '#d97706',
      logoKey: '',
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

  it('saves team colors and keeps them when the name changes', async () => {
    fixture.componentInstance.settings.patchValue({
      useColors: true,
      primary: '#7c2d12',
      secondary: '#1e40af',
      accent: '#f59e0b',
    });
    api.updateTeam.and.resolveTo({
      teamId: 'team-1',
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      location: 'Peoria, IL',
      role: 'team_admin',
      theme: { primary: '#7c2d12', secondary: '#1e40af', accent: '#f59e0b' },
    });

    await fixture.componentInstance.saveSettings();

    expect(api.updateTeam).toHaveBeenCalledWith('team-1', {
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      location: 'Peoria, IL',
      theme: { primary: '#7c2d12', secondary: '#1e40af', accent: '#f59e0b' },
    });
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

  it('creates an invite link when the caller can invite members', async () => {
    api.getPermissions.and.resolveTo({
      roles: [
        {
          role: 'team_admin',
          permissions: ['manage_permissions', 'invite_members'],
        },
      ],
    });
    api.createInvite.and.resolveTo({
      code: 'abc',
      teamId: 'team-1',
      role: 'player',
      createdAt: '2026-10-05T00:00:00.000Z',
    });
    api.listInvites.and.resolveTo([
      {
        code: 'abc',
        teamId: 'team-1',
        role: 'player',
        createdAt: '2026-10-05T00:00:00.000Z',
      },
    ]);

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Invite members');
    expect(text).toContain('/invite/abc');

    await fixture.componentInstance.createInviteLink();
    expect(api.createInvite).toHaveBeenCalledWith('team-1', 'player');
  });

  it('approves a join request with the chosen role', async () => {
    api.getPermissions.and.resolveTo({
      roles: [
        {
          role: 'team_admin',
          permissions: ['manage_permissions', 'approve_join_requests'],
        },
      ],
    });
    api.listJoinRequests.and.resolveTo([
      {
        requestId: 'req-1',
        userId: 'user-2',
        createdAt: '2026-10-06T00:00:00.000Z',
        displayName: 'Casey New',
        email: 'casey@localhost',
        accountKind: 'adult',
      },
    ]);
    api.approveJoinRequest.and.resolveTo({
      teamId: 'team-1',
      userId: 'user-2',
      role: 'coach',
      joinedAt: '2026-10-06T01:00:00.000Z',
      defaultChatId: 'chat-1',
    });

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Join requests');
    expect(text).toContain('Casey New');

    fixture.componentInstance.setJoinRole('req-1', 'coach');
    await fixture.componentInstance.approveJoin({
      requestId: 'req-1',
      userId: 'user-2',
      createdAt: '2026-10-06T00:00:00.000Z',
      displayName: 'Casey New',
      accountKind: 'adult',
    });
    fixture.detectChanges();

    expect(api.approveJoinRequest).toHaveBeenCalledWith('team-1', 'req-1', 'coach');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No pending requests.');
  });

  it('shows the roster and hides tools the caller cannot use', async () => {
    api.getTeam.and.resolveTo({
      teamId: 'team-1',
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      location: 'Peoria, IL',
      role: 'player',
    });
    api.getPermissions.and.resolveTo({
      roles: [
        {
          role: 'team_admin',
          permissions: [
            'manage_permissions',
            'invite_members',
            'approve_join_requests',
          ],
        },
        { role: 'player', permissions: [] },
      ],
    });
    api.listMembers.and.resolveTo([
      {
        userId: 'user-1',
        role: 'team_admin',
        joinedAt: '2026-10-06T00:00:00.000Z',
        displayName: 'Morgan Seacoast',
      },
      {
        userId: 'user-2',
        role: 'player',
        joinedAt: '2026-10-06T01:00:00.000Z',
        displayName: 'Casey New',
      },
    ]);
    api.listInvites.calls.reset();
    api.listJoinRequests.calls.reset();

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Peoria Pigs');
    expect(text).toContain('Roster');
    expect(text).toContain('Morgan Seacoast');
    expect(text).toContain('Casey New');
    expect(text).toContain('Player');
    expect(text).not.toContain('Settings');
    expect(text).not.toContain('Invite members');
    expect(text).not.toContain('Join requests');
    expect(text).not.toContain('Permissions');
    expect(api.listInvites).not.toHaveBeenCalled();
    expect(api.listJoinRequests).not.toHaveBeenCalled();
  });
});
