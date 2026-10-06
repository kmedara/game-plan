import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { TeamAdminPageComponent } from './teams';
import { ApiClientService } from '../core/api-client.service';

describe('TeamAdminPageComponent', () => {
  let fixture: ComponentFixture<TeamAdminPageComponent>;
  let api: SpyObj<ApiClientService>;

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', [
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
      'presignUpload',
      'presignDownload',
    ]);
    api.listInvites.mockResolvedValue([]);
    api.listJoinRequests.mockResolvedValue([]);
    api.listMembers.mockResolvedValue([
      {
        userId: 'user-1',
        role: 'team_admin',
        joinedAt: '2026-10-06T00:00:00.000Z',
        displayName: 'Morgan Seacoast',
      },
    ]);
    api.getTeam.mockResolvedValue({
      teamId: 'team-1',
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      location: 'Peoria, IL',
      role: 'team_admin',
    });
    api.getPermissions.mockResolvedValue({
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
    api.updateTeam.mockResolvedValue({
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
        { provide: ApiClientService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'team-1' } } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(api.listMembers).toHaveBeenCalled();
      expect(fixture.componentInstance.members().length).toBeGreaterThan(0);
    });
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
    api.updateTeam.mockResolvedValue({
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
    expect(timeZone.hasError('timeZone')).toBe(true);
    timeZone.setValue('Europe/London');
    expect(timeZone.valid).toBe(true);
  });

  it('filters time zone options by typed text', () => {
    fixture.componentInstance.settings.controls.timeZone.setValue('new york');
    expect(fixture.componentInstance.timeZoneOptions()).toEqual(['America/New_York']);
  });

  it('creates an invite link when the caller can invite members', async () => {
    api.getPermissions.mockResolvedValue({
      roles: [
        {
          role: 'team_admin',
          permissions: ['manage_permissions', 'invite_members'],
        },
      ],
    });
    api.createInvite.mockResolvedValue({
      code: 'abc',
      teamId: 'team-1',
      role: 'player',
      createdAt: '2026-10-05T00:00:00.000Z',
    });
    api.listInvites.mockResolvedValue([
      {
        code: 'abc',
        teamId: 'team-1',
        role: 'player',
        createdAt: '2026-10-05T00:00:00.000Z',
      },
    ]);
    api.listInvites.mockClear();
    api.listMembers.mockClear();

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(api.listInvites).toHaveBeenCalled();
    });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Invite members');
    expect(text).toContain('/invite/abc');

    await fixture.componentInstance.createInviteLink();
    expect(api.createInvite).toHaveBeenCalledWith('team-1', 'player');
  });

  it('approves a join request with the chosen role', async () => {
    api.getPermissions.mockResolvedValue({
      roles: [
        {
          role: 'team_admin',
          permissions: ['manage_permissions', 'approve_join_requests'],
        },
      ],
    });
    api.listJoinRequests.mockResolvedValue([
      {
        requestId: 'req-1',
        userId: 'user-2',
        createdAt: '2026-10-06T00:00:00.000Z',
        displayName: 'Casey New',
        email: 'casey@localhost',
        accountKind: 'adult',
      },
    ]);
    api.approveJoinRequest.mockResolvedValue({
      teamId: 'team-1',
      userId: 'user-2',
      role: 'coach',
      joinedAt: '2026-10-06T01:00:00.000Z',
      defaultChatId: 'chat-1',
    });
    api.listJoinRequests.mockClear();
    api.listMembers.mockClear();

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(api.listJoinRequests).toHaveBeenCalled();
    });
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

  it('declines join requests and maps approve failures', async () => {
    api.getPermissions.mockResolvedValue({
      roles: [
        {
          role: 'team_admin',
          permissions: ['manage_permissions', 'approve_join_requests'],
        },
      ],
    });
    const request = {
      requestId: 'req-2',
      userId: 'user-3',
      createdAt: '2026-10-06T00:00:00.000Z',
      displayName: 'Riley',
      accountKind: 'minor' as const,
    };
    api.listJoinRequests.mockResolvedValue([request]);
    api.rejectJoinRequest.mockResolvedValue(undefined);
    api.approveJoinRequest.mockRejectedValue(new Error('minor_cannot_be_team_admin'));

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(api.listJoinRequests).toHaveBeenCalled());

    await fixture.componentInstance.approveJoin(request);
    expect(fixture.componentInstance.joinError()).toContain('minor');

    await fixture.componentInstance.declineJoin(request);
    expect(api.rejectJoinRequest).toHaveBeenCalledWith('team-1', 'req-2');
    expect(fixture.componentInstance.joinRequests()).toEqual([]);

    fixture.componentInstance.busyRequestId.set('busy');
    await fixture.componentInstance.declineJoin(request);
    expect(api.rejectJoinRequest).toHaveBeenCalledTimes(1);
  });

  it('toggles and saves permissions', async () => {
    api.putPermissions.mockResolvedValue({
      roles: [
        {
          role: 'player',
          permissions: ['manage_events'],
        },
      ],
    });
    fixture.componentInstance.roles.set([
      { role: 'player', permissions: [] },
      { role: 'team_admin', permissions: ['manage_permissions'] },
    ]);
    fixture.componentInstance.toggle('player', 'manage_events', true);
    expect(fixture.componentInstance.has(fixture.componentInstance.roles()[0]!, 'manage_events')).toBe(
      true,
    );
    fixture.componentInstance.toggle('player', 'manage_events', false);
    expect(fixture.componentInstance.has(fixture.componentInstance.roles()[0]!, 'manage_events')).toBe(
      false,
    );
    fixture.componentInstance.toggle('team_admin', 'invite_members', true);
    expect(
      fixture.componentInstance.has(fixture.componentInstance.roles()[1]!, 'manage_permissions'),
    ).toBe(true);

    await fixture.componentInstance.save();
    expect(api.putPermissions).toHaveBeenCalled();

    api.putPermissions.mockRejectedValue(new Error('denied'));
    await fixture.componentInstance.save();
    expect(fixture.componentInstance.error()).toBe('denied');
  });

  it('uploads and removes logos and validates settings', async () => {
    api.presignUpload.mockResolvedValue({
      uploadUrl: 'https://upload.example',
      objectKey: 'uploads/logo',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);

    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    await fixture.componentInstance.onLogo({ target: input } as unknown as Event);
    expect(api.presignUpload).toHaveBeenCalled();
    expect(fixture.componentInstance.settings.controls.logoKey.value).toBe('uploads/logo');

    fixture.componentInstance.removeLogo();
    expect(fixture.componentInstance.settings.controls.logoKey.value).toBe('');
    expect(fixture.componentInstance.logoPreview()).toBeUndefined();

    fixture.componentInstance.settings.controls.name.setValue('   ');
    await fixture.componentInstance.saveSettings();
    expect(fixture.componentInstance.settingsError()).toContain('required');

    const bad = document.createElement('input');
    Object.defineProperty(bad, 'files', {
      value: [new File(['x'], 'logo.txt', { type: 'text/plain' })],
    });
    await fixture.componentInstance.onLogo({ target: bad } as unknown as Event);
    expect(fixture.componentInstance.settingsError()).toContain('JPEG');

    fetchMock.mockRestore();
  });

  it('copies invite links and surfaces create failures', async () => {
    api.createInvite.mockRejectedValue(new Error('fail'));
    api.getPermissions.mockResolvedValue({
      roles: [{ role: 'team_admin', permissions: ['manage_permissions', 'invite_members'] }],
    });
    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    await fixture.componentInstance.createInviteLink();
    expect(fixture.componentInstance.inviteError()).toContain('Could not create');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await fixture.componentInstance.copyInviteLink('abc');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/invite/abc'));
    expect(fixture.componentInstance.copiedCode()).toBe('abc');

    writeText.mockRejectedValue(new Error('denied'));
    await fixture.componentInstance.copyInviteLink('abc');
    expect(fixture.componentInstance.inviteError()).toContain('Could not copy');
  });

  it('covers roster errors, logo limits, minors, and destroy branding restore', async () => {
    api.listMembers.mockRejectedValue(new Error('roster'));
    api.listInvites.mockRejectedValue(new Error('invites'));
    api.listJoinRequests.mockRejectedValue(new Error('joins'));
    api.getPermissions.mockResolvedValue({
      roles: [
        {
          role: 'team_admin',
          permissions: [
            'manage_permissions',
            'invite_members',
            'approve_join_requests',
            'assign_roles',
          ],
        },
        { role: 'coach', permissions: ['manage_permissions'] },
      ],
    });
    api.getTeam.mockResolvedValue({
      teamId: 'team-1',
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      role: 'team_admin',
      theme: { logoKey: 'uploads/logo' },
    });
    api.presignDownload.mockResolvedValue({
      downloadUrl: 'https://cdn.example/logo.png',
      objectKey: 'uploads/logo',
    });
    api.getTeamId = vi.fn().mockReturnValue('other-team');
    api.getTeam.mockImplementation(async (id: string) => {
      if (id === 'other-team') {
        return {
          teamId: 'other-team',
          name: 'Other',
          timeZone: 'UTC',
          role: 'player',
          theme: { primary: '#111111' },
        };
      }
      return {
        teamId: 'team-1',
        name: 'Peoria Pigs',
        timeZone: 'America/Chicago',
        role: 'team_admin',
        theme: { logoKey: 'uploads/logo' },
      };
    });

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(fixture.componentInstance.rosterError()).toContain('roster');
    });

    const huge = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [huge] });
    await fixture.componentInstance.onLogo({ target: input } as unknown as Event);
    expect(fixture.componentInstance.settingsError()).toContain('5 MB');

    expect(
      fixture.componentInstance.roleBlocked(
        {
          requestId: 'r',
          userId: 'u',
          createdAt: '2026-01-01T00:00:00.000Z',
          accountKind: 'minor',
        },
        'team_admin',
      ),
    ).toBe(true);
    expect(
      fixture.componentInstance.roleBlocked(
        {
          requestId: 'r',
          userId: 'u',
          createdAt: '2026-01-01T00:00:00.000Z',
          accountKind: 'minor',
        },
        'coach',
      ),
    ).toBe(true);
    expect(
      fixture.componentInstance.roleBlocked(
        {
          requestId: 'r',
          userId: 'u',
          createdAt: '2026-01-01T00:00:00.000Z',
          accountKind: 'adult',
        },
        'team_admin',
      ),
    ).toBe(false);

    api.updateTeam.mockRejectedValue(new Error('save_failed'));
    fixture.componentInstance.settings.patchValue({
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      location: '',
    });
    await fixture.componentInstance.saveSettings();
    expect(fixture.componentInstance.settingsError()).toBe('save_failed');

    api.rejectJoinRequest.mockRejectedValue(new Error('join_request_not_found'));
    fixture.componentInstance.joinRequests.set([
      {
        requestId: 'req-9',
        userId: 'u9',
        createdAt: '2026-01-01T00:00:00.000Z',
        accountKind: 'adult',
      },
    ]);
    await fixture.componentInstance.declineJoin({
      requestId: 'req-9',
      userId: 'u9',
      createdAt: '2026-01-01T00:00:00.000Z',
      accountKind: 'adult',
    });
    expect(fixture.componentInstance.joinError()).toContain('no longer pending');

    fixture.componentInstance.ngOnDestroy();
    await vi.waitFor(() => {
      expect(api.getTeam).toHaveBeenCalledWith('other-team');
    });
  });

  it('shows the roster and hides tools the caller cannot use', async () => {
    api.getTeam.mockResolvedValue({
      teamId: 'team-1',
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      location: 'Peoria, IL',
      role: 'player',
    });
    api.getPermissions.mockResolvedValue({
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
    api.listMembers.mockResolvedValue([
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
    api.listInvites.mockClear();
    api.listJoinRequests.mockClear();
    api.listMembers.mockClear();

    fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(api.listMembers).toHaveBeenCalled();
      expect(fixture.componentInstance.members().length).toBe(2);
    });
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

describe('TeamAdminPageComponent edge branches', () => {
  let api: SpyObj<ApiClientService>;

  const adminPermissions = [
    'manage_permissions',
    'invite_members',
    'approve_join_requests',
  ] as const;

  const mount = async (options: {
    teamIdParam?: string | null;
    callerRole?: 'team_admin' | 'player';
  } = {}): Promise<ComponentFixture<TeamAdminPageComponent>> => {
    api = createSpyObj<ApiClientService>('ApiClientService', [
      'getTeam',
      'updateTeam',
      'getPermissions',
      'putPermissions',
      'listInvites',
      'createInvite',
      'listJoinRequests',
      'approveJoinRequest',
      'listMembers',
      'presignUpload',
    ]);
    api.getTeam.mockResolvedValue({
      teamId: 'team-1',
      name: 'Peoria Pigs',
      timeZone: 'America/Chicago',
      role: options.callerRole ?? 'team_admin',
    });
    api.getPermissions.mockResolvedValue({
      roles: [{ role: 'team_admin', permissions: [...adminPermissions] }],
    });
    api.listMembers.mockResolvedValue([]);
    api.listInvites.mockResolvedValue([]);
    api.listJoinRequests.mockResolvedValue([]);

    await TestBed.configureTestingModule({
      imports: [TeamAdminPageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: () => (options.teamIdParam === undefined ? 'team-1' : options.teamIdParam),
              },
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TeamAdminPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(api.listMembers).toHaveBeenCalled());
    return fixture;
  };

  it('treats a missing route param and an unknown caller role as no permissions', async () => {
    const fixture = await mount({ teamIdParam: null, callerRole: 'player' });
    expect(api.getTeam).toHaveBeenCalledWith('');
    expect(fixture.componentInstance.canManage()).toBe(false);
    expect(fixture.componentInstance.canInvite()).toBe(false);
    expect(fixture.componentInstance.canApprove()).toBe(false);

    await fixture.componentInstance.createInviteLink();
    expect(api.createInvite).not.toHaveBeenCalled();
  });

  it('skips creating an invite while one is already being created', async () => {
    const fixture = await mount();
    fixture.componentInstance.creatingInvite.set(true);
    await fixture.componentInstance.createInviteLink();
    expect(api.createInvite).not.toHaveBeenCalled();
  });

  it('shows a generic invite error when the invite list rejects with a non-error', async () => {
    api = undefined as never;
    TestBed.resetTestingModule();
    const fixture = await mount();
    api.listInvites.mockRejectedValue('nope');
    const again = TestBed.createComponent(TeamAdminPageComponent);
    again.detectChanges();
    await again.whenStable();
    await vi.waitFor(() => expect(again.componentInstance.inviteError()).toBe('invite_failed'));
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('ignores approve while another request is busy', async () => {
    const fixture = await mount();
    fixture.componentInstance.busyRequestId.set('other');
    await fixture.componentInstance.approveJoin({
      requestId: 'req-1',
      userId: 'user-2',
      createdAt: '2026-10-06T00:00:00.000Z',
      accountKind: 'adult',
    });
    expect(api.approveJoinRequest).not.toHaveBeenCalled();
  });

  it('sorts the roster by role, then by name or email', async () => {
    api = undefined as never;
    TestBed.resetTestingModule();
    const first = await mount();
    api.listMembers.mockResolvedValue([
      { userId: 'p1', role: 'player', joinedAt: '2026-10-06T00:00:00.000Z', email: 'zed@example.com' },
      { userId: 'p2', role: 'player', joinedAt: '2026-10-06T00:00:00.000Z', displayName: 'Amy' },
      { userId: 'p3', role: 'player', joinedAt: '2026-10-06T00:00:00.000Z' },
      { userId: 'p4', role: 'player', joinedAt: '2026-10-06T00:00:00.000Z' },
      { userId: 'a1', role: 'team_admin', joinedAt: '2026-10-06T00:00:00.000Z', displayName: 'Boss' },
    ]);
    const second = TestBed.createComponent(TeamAdminPageComponent);
    second.detectChanges();
    await second.whenStable();
    await vi.waitFor(() => expect(second.componentInstance.members()).toHaveLength(5));
    expect(second.componentInstance.members().map((member) => member.userId)).toEqual([
      'a1',
      'p3',
      'p4',
      'p2',
      'p1',
    ]);
    expect(first.componentInstance).toBeTruthy();
  });

  it('does not save invalid settings and reports non-error save failures', async () => {
    const fixture = await mount();
    fixture.componentInstance.settings.controls.name.setValue('');
    await fixture.componentInstance.saveSettings();
    expect(api.updateTeam).not.toHaveBeenCalled();

    fixture.componentInstance.settings.controls.name.setValue('Valid');
    api.updateTeam.mockRejectedValue('offline');
    await fixture.componentInstance.saveSettings();
    expect(fixture.componentInstance.settingsError()).toBe('save_failed');
  });

  it('ignores an empty logo choice and reports a refused logo upload', async () => {
    const fixture = await mount();
    await fixture.componentInstance.onLogo({
      target: document.createElement('input'),
    } as unknown as Event);
    expect(api.presignUpload).not.toHaveBeenCalled();

    api.presignUpload.mockResolvedValue({ uploadUrl: 'https://upload.example', objectKey: 'k' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'logo.png', { type: 'image/png' })],
    });
    await fixture.componentInstance.onLogo({ target: input } as unknown as Event);
    expect(fixture.componentInstance.settingsError()).toContain('Could not upload');
    expect(fixture.componentInstance.settings.controls.logoKey.value).toBe('');
  });

  it('reports non-error permission save failures', async () => {
    const fixture = await mount();
    api.putPermissions.mockRejectedValue('offline');
    await fixture.componentInstance.save();
    expect(fixture.componentInstance.error()).toBe('save_failed');
  });
});
