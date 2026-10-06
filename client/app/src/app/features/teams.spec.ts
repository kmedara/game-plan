import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TeamSummary } from '@gameplan/types';
import { TeamsPageComponent } from './teams';
import { ApiClient } from '../core/api-client';

describe('TeamsPageComponent', () => {
  let fixture: ComponentFixture<TeamsPageComponent>;

  beforeEach(async () => {
    const api = jasmine.createSpyObj<ApiClient>('ApiClient', [
      'listTeams',
      'createTeam',
      'restoreTeamId',
      'getTeamId',
      'setTeamId',
      'logout',
      'searchTeams',
      'requestJoin',
    ]);
    api.listTeams.and.resolveTo([]);
    api.restoreTeamId.and.resolveTo(undefined);
    api.getTeamId.and.returnValue(undefined);
    api.searchTeams.and.resolveTo({ teams: [] });

    await TestBed.configureTestingModule({
      imports: [TeamsPageComponent],
      providers: [provideRouter([]), { provide: ApiClient, useValue: api }],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('selects join by default and hides both forms when neither option is selected', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Join an existing team or create a new one');
    expect(root.textContent).toContain('Request to join');
    expect(root.querySelector('form')).toBeNull();

    const [join, create] = [...root.querySelectorAll('button')].filter((button) =>
      button.textContent?.includes('Join team') || button.textContent?.includes('Create team'),
    );
    expect(join?.classList.contains('active')).toBeTrue();
    expect(create?.classList.contains('active')).toBeFalse();

    join?.click();
    fixture.detectChanges();
    expect(join?.classList.contains('active')).toBeFalse();
    expect(root.textContent).not.toContain('Request to join');
    expect(root.querySelector('form')).toBeNull();

    join?.click();
    fixture.detectChanges();
    expect(join?.classList.contains('active')).toBeTrue();
    expect(root.textContent).toContain('Request to join');

    create?.click();
    fixture.detectChanges();
    expect(create?.classList.contains('active')).toBeTrue();
    expect(join?.classList.contains('active')).toBeFalse();
    expect(root.textContent).not.toContain('Request to join');
    expect(root.querySelector('form')).not.toBeNull();

    create?.click();
    fixture.detectChanges();
    expect(create?.classList.contains('active')).toBeFalse();
    expect(root.querySelector('form')).toBeNull();
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
  }): Promise<{ fixture: ComponentFixture<TeamsPageComponent>; api: jasmine.SpyObj<ApiClient> }> => {
    const api = jasmine.createSpyObj<ApiClient>('ApiClient', [
      'listTeams',
      'restoreTeamId',
      'getTeamId',
      'setTeamId',
      'searchTeams',
      'getPermissions',
      'listJoinRequests',
    ]);
    api.listTeams.and.resolveTo([team(options.role)]);
    api.restoreTeamId.and.resolveTo(undefined);
    api.getTeamId.and.returnValue(undefined);
    api.searchTeams.and.resolveTo({ teams: [] });
    api.getPermissions.and.resolveTo({
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
    api.listJoinRequests.and.resolveTo(
      options.pending
        ? [{ requestId: 'req-1', userId: 'user-2', createdAt: '2026-01-01T00:00:00.000Z' }]
        : [],
    );

    await TestBed.configureTestingModule({
      imports: [TeamsPageComponent],
      providers: [provideRouter([]), { provide: ApiClient, useValue: api }],
    }).compileComponents();

    const fixture = TestBed.createComponent(TeamsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api };
  };

  const adminMark = (fixture: ComponentFixture<TeamsPageComponent>): string =>
    (fixture.nativeElement as HTMLElement).querySelector('.team-admin-mark')?.textContent?.trim() ??
    '';

  it('replaces Admin with a bell when the caller can approve pending join requests', async () => {
    const { fixture } = await setup({ role: 'team_admin', canApprove: true, pending: true });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.team-pending')?.textContent?.trim()).toBe('notifications');
    expect(adminMark(fixture)).toContain('Pending join requests');
    expect(adminMark(fixture)).not.toContain('Admin');
  });

  it('keeps Admin when there is nothing to approve', async () => {
    const { fixture, api } = await setup({ role: 'team_admin', canApprove: true, pending: false });
    expect(adminMark(fixture)).toBe('Admin');
    expect(api.listJoinRequests).toHaveBeenCalledWith('team-1');
  });

  it('keeps Admin when the caller cannot approve join requests', async () => {
    const { fixture, api } = await setup({ role: 'player', canApprove: false, pending: true });
    expect(adminMark(fixture)).toBe('Admin');
    expect(api.listJoinRequests).not.toHaveBeenCalled();
  });
});
