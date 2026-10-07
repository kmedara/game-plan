import { createSpyObj, type SpyObj } from '../../testing/spy';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { TeamSummary } from '@gameplan/types';
import {
  TeamsPageComponent,
  inviteCodeFromInput,
  joinRequestMessage,
  listTimeZones,
  roleLabel,
} from './teams';
import { ActiveTeamService } from '../core/active-team.service';
import { ApiClientService } from '../core/api-client.service';
import { TeamBrandService } from '../core/team-brand.service';

describe('listTimeZones', () => {
  it('includes UTC when the runtime omits it', () => {
    const spy = vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['America/New_York']);
    expect(listTimeZones()).toContain('UTC');
    spy.mockReturnValue(['America/New_York', 'UTC']);
    expect(listTimeZones()).toContain('UTC');
    spy.mockRestore();
  });
});

describe('roleLabel', () => {
  it('labels known roles and passes through unknown values', () => {
    expect(roleLabel('coach')).toBe('role.coach');
    expect(roleLabel('custom')).toBe('custom');
  });
});

describe('joinRequestMessage', () => {
  it('maps known join-request errors', () => {
    expect(joinRequestMessage(new Error('minor_cannot_be_team_admin'))).toBe(
      'errors.join.minorCannotBeTeamAdmin',
    );
    expect(joinRequestMessage(new Error('minor_cannot_hold_manage_permissions'))).toBe(
      'errors.join.minorCannotManagePermissions',
    );
    expect(joinRequestMessage(new Error('already_a_member'))).toBe('errors.join.alreadyMember');
    expect(joinRequestMessage(new Error('join_request_not_found'))).toBe('errors.join.notPending');
    expect(joinRequestMessage(new Error('not_found'))).toBe('errors.join.notPending');
    expect(joinRequestMessage(new Error('other'))).toBe('errors.join.updateFailed');
    expect(joinRequestMessage('plain')).toBe('errors.join.updateFailed');
  });
});

describe('inviteCodeFromInput', () => {
  it('reads bare codes and invite URL paths', () => {
    expect(inviteCodeFromInput('')).toBe('');
    expect(inviteCodeFromInput('  bare-code  ')).toBe('bare-code');
    expect(inviteCodeFromInput('http://localhost/invite/abc%2F123')).toBe('abc/123');
    expect(inviteCodeFromInput('http://localhost/invite/%')).toBe('http://localhost/invite/%');
  });
});

describe('TeamsPageComponent', () => {
  let fixture: ComponentFixture<TeamsPageComponent>;
  let api: SpyObj<ApiClientService>;
  let activeTeam: {
    teams: ReturnType<typeof signal<TeamSummary[]>>;
    refresh: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', [
      'createTeam',
      'searchTeams',
      'requestJoin',
      'getPermissions',
      'listJoinRequests',
    ]);
    api.searchTeams.mockResolvedValue({ teams: [] });
    api.getPermissions.mockResolvedValue({ roles: [] });
    api.listJoinRequests.mockResolvedValue([]);
    activeTeam = {
      teams: signal<TeamSummary[]>([]),
      refresh: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [TeamsPageComponent],
      providers: [
        provideRouter([{ path: 'schedule', children: [] }, { path: 'invite/:code', children: [] }]),
        { provide: ApiClientService, useValue: api },
        { provide: ActiveTeamService, useValue: activeTeam },
        {
          provide: TeamBrandService,
          useValue: { logoFor: () => undefined, rememberLogo: () => Promise.resolve() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('toggles join and create forms', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Join an existing team or create a new one');
    expect(root.querySelector('form')).toBeNull();
    expect(root.textContent).not.toContain('Request to join');

    const [join, create] = [...root.querySelectorAll('button')].filter(
      (button) =>
        button.textContent?.includes('Join team') ||
        button.textContent?.includes('Create team'),
    );
    expect(join?.classList.contains('active')).toBe(false);
    expect(create?.classList.contains('active')).toBe(false);

    join?.click();
    fixture.detectChanges();
    expect(join?.classList.contains('active')).toBe(true);
    expect(root.textContent).toContain('Request to join');
    expect(root.querySelector('form')).toBeNull();

    join?.click();
    fixture.detectChanges();
    expect(join?.classList.contains('active')).toBe(false);
    expect(root.textContent).not.toContain('Request to join');

    create?.click();
    fixture.detectChanges();
    expect(create?.classList.contains('active')).toBe(true);
    expect(join?.classList.contains('active')).toBe(false);
    expect(root.textContent).not.toContain('Request to join');
    expect(root.querySelector('form')).not.toBeNull();

    create?.click();
    fixture.detectChanges();
    expect(create?.classList.contains('active')).toBe(false);
    expect(root.querySelector('form')).toBeNull();
  });

  it('formats join autocomplete labels and tracks pending approvals', () => {
    const component = fixture.componentInstance;
    expect(component.displayTeam(null)).toBe('');
    expect(component.displayTeam('typed')).toBe('typed');
    expect(component.displayTeam({ teamId: 't1', name: 'Seacoast' })).toBe('Seacoast');
    expect(component.hasPendingApprovals('missing')).toBe(false);
    component.onJoinSelected({ teamId: 't1', name: 'Seacoast' });
    expect(component.selectedJoin()?.name).toBe('Seacoast');
  });

  it('requests to join a selected team', async () => {
    const component = fixture.componentInstance;
    component.selectMode('join');
    component.onJoinSelected({ teamId: 't1', name: 'Seacoast' });
    api.requestJoin.mockResolvedValue(undefined);
    await component.requestJoin();
    expect(api.requestJoin).toHaveBeenCalledWith('t1');
    expect(component.joinMessage()).toBe('teams.joinRequestSent');
  });

  it('creates a team and navigates to the schedule', async () => {
    const component = fixture.componentInstance;
    component.selectMode('create');
    component.form.setValue({ name: 'New Team', timeZone: 'America/New_York' });
    api.createTeam.mockResolvedValue({
      teamId: 'new-team',
      name: 'New Team',
      timeZone: 'America/New_York',
      role: 'team_admin',
    });
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    await component.create();
    expect(activeTeam.refresh).toHaveBeenCalled();
    expect(activeTeam.select).toHaveBeenCalledWith('new-team');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/schedule');
  });

  it('opens the invite page for a pasted code', async () => {
    const component = fixture.componentInstance;
    component.inviteCode.setValue(inviteCodeFromInput('http://localhost/invite/abc123'));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await component.openInvite();
    expect(navigate).toHaveBeenCalledWith(['/invite', 'abc123']);
  });

  it('clears directory hits when search fails', async () => {
    api.searchTeams.mockRejectedValue(new Error('offline'));
    fixture = TestBed.createComponent(TeamsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.directoryHits()).toEqual([]);
  });

  it('paginates directory results from the join panel scroll', async () => {
    api.searchTeams
      .mockResolvedValueOnce({
        teams: [{ teamId: 't1', name: 'One' }],
        cursor: 'next',
      })
      .mockResolvedValueOnce({
        teams: [{ teamId: 't2', name: 'Two' }],
        cursor: undefined,
      });
    fixture = TestBed.createComponent(TeamsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const panel = document.createElement('div');
    Object.defineProperties(panel, {
      scrollHeight: { get: () => 200 },
      scrollTop: { get: () => 180 },
      clientHeight: { get: () => 20 },
    });
    fixture.componentInstance['joinAuto'] = {
      panel: { nativeElement: panel },
    } as never;
    fixture.componentInstance.onJoinPanelOpened();
    await Promise.resolve();
    panel.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => {
      expect(api.searchTeams).toHaveBeenCalledWith('', {
        limit: 10,
        cursor: 'next',
      });
    });
    expect(fixture.componentInstance.directoryHits().map((hit) => hit.teamId)).toEqual([
      't1',
      't2',
    ]);
    expect(fixture.componentInstance.directoryLoadingMore()).toBe(false);
    fixture.componentInstance.onJoinPanelClosed();
  });

  it('clears the loading flag after a completed directory page load', async () => {
    const component = fixture.componentInstance;
    component['directoryCursor'] = 'cursor-1';
    component['searchSeq'] = 7;
    api.searchTeams.mockResolvedValue({ teams: [{ teamId: 't8', name: 'Eight' }] });
    await component['loadMoreDirectory']();
    expect(component.directoryLoadingMore()).toBe(false);
    expect(component.directoryHits().some((hit) => hit.teamId === 't8')).toBe(true);
  });

  it('keeps existing directory rows when a page load fails', async () => {
    const component = fixture.componentInstance;
    component.directoryHits.set([{ teamId: 't1', name: 'One' }]);
    component['directoryCursor'] = 'cursor-2';
    api.searchTeams.mockRejectedValue(new Error('offline'));
    await component['loadMoreDirectory']();
    expect(component.directoryHits()).toEqual([{ teamId: 't1', name: 'One' }]);
    expect(component.directoryLoadingMore()).toBe(false);
  });

  it('surfaces join and create failures', async () => {
    const component = fixture.componentInstance;
    component.selectMode('join');
    component.onJoinSelected({ teamId: 't1', name: 'Seacoast' });
    api.requestJoin.mockRejectedValue(new Error('already_pending'));
    await component.requestJoin();
    expect(component.error()).toBe('already_pending');

    component.selectMode('create');
    component.form.setValue({ name: 'New', timeZone: 'America/New_York' });
    api.createTeam.mockRejectedValue('boom');
    await component.create();
    expect(component.error()).toBe('create_failed');
  });

  it('reacts to join control typing and autocomplete selection', async () => {
    api.searchTeams.mockResolvedValue({ teams: [{ teamId: 't9', name: 'Nines' }] });
    const component = fixture.componentInstance;
    component.joinControl.setValue('nin');
    await vi.waitFor(() => {
      expect(api.searchTeams).toHaveBeenCalledWith('nin', { limit: 10 });
    });
    component.joinControl.setValue({ teamId: 't9', name: 'Nines' });
    expect(component.selectedJoin()?.teamId).toBe('t9');
  });

  it('ignores stale directory pages when a newer search starts', async () => {
    let resolveMore!: (value: { teams: Array<{ teamId: string; name: string }>; cursor?: string }) => void;
    api.searchTeams
      .mockResolvedValueOnce({ teams: [{ teamId: 't1', name: 'One' }], cursor: 'c1' })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMore = resolve;
          }),
      )
      .mockResolvedValueOnce({ teams: [{ teamId: 't3', name: 'Three' }] });

    fixture = TestBed.createComponent(TeamsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const panel = document.createElement('div');
    Object.defineProperties(panel, {
      scrollHeight: { get: () => 200 },
      scrollTop: { get: () => 180 },
      clientHeight: { get: () => 20 },
    });
    fixture.componentInstance['joinAuto'] = {
      panel: { nativeElement: panel },
    } as never;
    fixture.componentInstance.onJoinPanelOpened();
    await Promise.resolve();
    panel.dispatchEvent(new Event('scroll'));
    fixture.componentInstance.joinControl.setValue('fresh');
    resolveMore({ teams: [{ teamId: 't2', name: 'Two' }], cursor: undefined });
    await fixture.whenStable();
    expect(fixture.componentInstance.directoryLoadingMore()).toBe(false);
  });

  describe('guards and superseded requests', () => {
    const deferred = <T>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (reason: unknown) => void;
    } => {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    it('skips the scroll listener when the autocomplete panel is not rendered', async () => {
      const component = fixture.componentInstance;
      component.onJoinPanelOpened();
      await Promise.resolve();
      expect(component['joinPanelEl']).toBeUndefined();
    });

    it('ignores panel scroll without a panel or a next page', async () => {
      const component = fixture.componentInstance;
      const before = api.searchTeams.mock.calls.length;
      component['onJoinPanelScroll']();

      component['joinPanelEl'] = document.createElement('div');
      component['directoryCursor'] = undefined;
      component['onJoinPanelScroll']();

      await component['loadMoreDirectory']();
      expect(api.searchTeams.mock.calls.length).toBe(before);
    });

    it('drops a superseded directory search result', async () => {
      const component = fixture.componentInstance;
      const first = deferred<{ teams: { teamId: string; name: string }[] }>();
      api.searchTeams.mockReturnValueOnce(first.promise);
      api.searchTeams.mockResolvedValueOnce({ teams: [{ teamId: 'b', name: 'Bravo' }] });

      const stale = component['searchDirectory']('a');
      await component['searchDirectory']('b');
      first.resolve({ teams: [{ teamId: 'a', name: 'Alpha' }] });
      await stale;
      expect(component.directoryHits().map((hit) => hit.teamId)).toEqual(['b']);
    });

    it('drops a superseded directory search failure', async () => {
      const component = fixture.componentInstance;
      const first = deferred<{ teams: { teamId: string; name: string }[] }>();
      api.searchTeams.mockReturnValueOnce(first.promise);
      api.searchTeams.mockResolvedValueOnce({ teams: [{ teamId: 'b', name: 'Bravo' }] });

      const stale = component['searchDirectory']('a');
      await component['searchDirectory']('b');
      first.reject(new Error('offline'));
      await stale;
      expect(component.directoryHits().map((hit) => hit.teamId)).toEqual(['b']);
    });

    it('drops a directory page that arrives after a newer search starts', async () => {
      const component = fixture.componentInstance;
      const more = deferred<{ teams: { teamId: string; name: string }[] }>();
      component.directoryHits.set([{ teamId: 'a', name: 'Alpha' }]);
      component['directoryCursor'] = 'next';
      api.searchTeams.mockReturnValueOnce(more.promise);

      const pending = component['loadMoreDirectory']();
      component['searchSeq'] += 1;
      more.resolve({ teams: [{ teamId: 'late', name: 'Late' }] });
      await pending;
      expect(component.directoryHits().map((hit) => hit.teamId)).toEqual(['a']);
    });

    it('uses an empty permission list when the team role is missing from the matrix', async () => {
      const component = fixture.componentInstance;
      await component['loadPendingApprovals']([
        { teamId: 'team-1', name: 'Seacoast', timeZone: 'UTC', role: 'player' },
      ]);
      expect(component.hasPendingApprovals('team-1')).toBe(false);
    });

    it('ignores approvals that finish after the page is destroyed', async () => {
      const component = fixture.componentInstance;
      const matrix = deferred<Awaited<ReturnType<ApiClientService['getPermissions']>>>();
      api.getPermissions.mockReturnValueOnce(matrix.promise);
      api.listJoinRequests.mockResolvedValue([
        { requestId: 'req-1', userId: 'user-2', createdAt: '2026-01-01T00:00:00.000Z' },
      ]);

      const pending = component['loadPendingApprovals']([
        { teamId: 'team-1', name: 'Seacoast', timeZone: 'UTC', role: 'team_admin' },
      ]);
      component.ngOnDestroy();
      matrix.resolve({
        roles: [{ role: 'team_admin', permissions: ['approve_join_requests'] }],
      });
      await pending;
      expect(component.hasPendingApprovals('team-1')).toBe(false);
    });

    it('does nothing when joining without a selected team', async () => {
      await fixture.componentInstance.requestJoin();
      expect(api.requestJoin).not.toHaveBeenCalled();
    });

    it('reports a generic error when joining rejects with a non-error', async () => {
      const component = fixture.componentInstance;
      component.onJoinSelected({ teamId: 't1', name: 'Seacoast' });
      api.requestJoin.mockRejectedValue('boom');
      await component.requestJoin();
      expect(component.error()).toBe('join_failed');
    });

    it('does not create a team while the form is invalid', async () => {
      const component = fixture.componentInstance;
      component.form.setValue({ name: '', timeZone: 'America/New_York' });
      await component.create();
      expect(api.createTeam).not.toHaveBeenCalled();
    });

    it('shows the error message when creating a team rejects with an error', async () => {
      const component = fixture.componentInstance;
      component.form.setValue({ name: 'New', timeZone: 'America/New_York' });
      api.createTeam.mockRejectedValue(new Error('duplicate_name'));
      await component.create();
      expect(component.error()).toBe('duplicate_name');
    });
  });

  it('ignores empty invite codes', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.inviteCode.setValue('   ');
    await fixture.componentInstance.openInvite();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('TeamsPageComponent pending approvals', () => {
  const team = (role: TeamSummary['role']): TeamSummary => ({
    teamId: 'team-1',
    name: 'Seacoast',
    timeZone: 'America/New_York',
    location: 'Portsmouth, NH',
    role,
  });

  const setup = async (options: {
    role: TeamSummary['role'];
    canApprove: boolean;
    pending: boolean;
  }): Promise<{ fixture: ComponentFixture<TeamsPageComponent>; api: SpyObj<ApiClientService> }> => {
    const api = createSpyObj<ApiClientService>('ApiClientService', [
      'searchTeams',
      'getPermissions',
      'listJoinRequests',
    ]);
    const teams = signal([team(options.role)]);
    const activeTeam = {
      teams,
      refresh: vi.fn().mockImplementation(async () => undefined),
      select: vi.fn().mockResolvedValue(undefined),
    };
    api.searchTeams.mockResolvedValue({ teams: [] });
    api.getPermissions.mockResolvedValue({
      roles: [
        {
          role: 'team_admin',
          permissions: options.canApprove ? ['approve_join_requests'] : [],
        },
        { role: 'coach', permissions: [] },
        { role: 'parent', permissions: [] },
        { role: 'player', permissions: [] },
      ],
    });
    api.listJoinRequests.mockResolvedValue(
      options.pending
        ? [{ requestId: 'req-1', userId: 'user-2', createdAt: '2026-01-01T00:00:00.000Z' }]
        : [],
    );

    await TestBed.configureTestingModule({
      imports: [TeamsPageComponent],
      providers: [
        provideRouter([{ path: 'schedule', children: [] }, { path: 'invite/:code', children: [] }]),
        { provide: ApiClientService, useValue: api },
        { provide: ActiveTeamService, useValue: activeTeam },
        {
          provide: TeamBrandService,
          useValue: { logoFor: () => undefined, rememberLogo: () => Promise.resolve() },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TeamsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(api.getPermissions).toHaveBeenCalled();
      if (options.canApprove && options.pending) {
        expect(api.listJoinRequests).toHaveBeenCalled();
      }
      fixture.detectChanges();
      if (options.canApprove && options.pending) {
        expect(
          (fixture.nativeElement as HTMLElement).querySelector('.team-pending'),
        ).not.toBeNull();
      }
    });
    fixture.detectChanges();
    return { fixture, api };
  };

  it('shows a notification mark when join requests are pending', async () => {
    const { fixture } = await setup({ role: 'team_admin', canApprove: true, pending: true });
    const mark = (fixture.nativeElement as HTMLElement).querySelector('.team-pending');
    expect(mark).not.toBeNull();
  });

  it('hides the notification mark when there are no pending requests', async () => {
    const { fixture } = await setup({ role: 'team_admin', canApprove: true, pending: false });
    expect((fixture.nativeElement as HTMLElement).querySelector('.team-pending')).toBeNull();
  });

  it('treats permission load failures as no pending approvals', async () => {
    const api = createSpyObj<ApiClientService>('ApiClientService', [
      'searchTeams',
      'getPermissions',
      'listJoinRequests',
    ]);
    const teams = signal([team('team_admin')]);
    api.searchTeams.mockResolvedValue({ teams: [] });
    api.getPermissions.mockRejectedValue(new Error('offline'));
    await TestBed.configureTestingModule({
      imports: [TeamsPageComponent],
      providers: [
        provideRouter([{ path: 'schedule', children: [] }, { path: 'invite/:code', children: [] }]),
        { provide: ApiClientService, useValue: api },
        {
          provide: ActiveTeamService,
          useValue: {
            teams,
            refresh: vi.fn().mockResolvedValue(undefined),
            select: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: TeamBrandService,
          useValue: { logoFor: () => undefined, rememberLogo: () => Promise.resolve() },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(TeamsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(api.getPermissions).toHaveBeenCalled());
    expect(fixture.componentInstance.hasPendingApprovals('team-1')).toBe(false);
  });
});
