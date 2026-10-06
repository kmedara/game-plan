import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ActiveTeamService } from '../core/active-team.service';
import { ApiClientService } from '../core/api-client.service';
import { InvitePageComponent, inviteErrorMessage } from './invite';
import { inviteCodeFromInput } from './teams';

describe('inviteCodeFromInput', () => {
  it('reads a code from a shared link or bare text', () => {
    expect(inviteCodeFromInput('  http://localhost:4200/invite/abc_def?x=1  ')).toBe('abc_def');
    expect(inviteCodeFromInput('/invite/abc%2Fdef')).toBe('abc/def');
    expect(inviteCodeFromInput('plaincode')).toBe('plaincode');
    expect(inviteCodeFromInput('   ')).toBe('');
  });
});

describe('inviteErrorMessage', () => {
  it('explains known invite failures', () => {
    expect(inviteErrorMessage(new Error('not_found'))).toContain('not valid');
    expect(inviteErrorMessage(new Error('already_a_member'))).toContain('already');
    expect(inviteErrorMessage(new Error('minor_cannot_be_team_admin'))).toContain('not available');
    expect(inviteErrorMessage(new Error('forbidden'))).toContain('cannot use');
    expect(inviteErrorMessage(new Error('other'))).toContain('Could not use');
    expect(inviteErrorMessage('plain')).toContain('Could not use');
  });
});

describe('InvitePageComponent', () => {
  let fixture: ComponentFixture<InvitePageComponent>;
  let api: SpyObj<ApiClientService>;
  let activeTeam: SpyObj<ActiveTeamService>;

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', ['getInvite', 'acceptInvite']);
    activeTeam = createSpyObj<ActiveTeamService>('ActiveTeamService', ['refresh', 'select']);
    activeTeam.refresh.mockResolvedValue(undefined);
    activeTeam.select.mockResolvedValue(undefined);
    api.getInvite.mockResolvedValue({
      code: 'abc',
      teamId: 'team-1',
      teamName: 'Seacoast',
      role: 'player',
      createdAt: '2026-10-05T00:00:00.000Z',
    });

    await TestBed.configureTestingModule({
      imports: [InvitePageComponent],
      providers: [
        provideRouter([{ path: 'schedule', children: [] }]),
        { provide: ApiClientService, useValue: api },
        { provide: ActiveTeamService, useValue: activeTeam },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'abc' } } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InvitePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows the team and role, then joins', async () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Join Seacoast');
    expect(text).toContain('Player');
    expect(api.getInvite).toHaveBeenCalledWith('abc');

    api.acceptInvite.mockResolvedValue({
      teamId: 'team-1',
      name: 'Seacoast',
      timeZone: 'America/New_York',
      defaultChatId: 'chat-1',
      role: 'player',
      joinedAt: '2026-10-05T00:00:00.000Z',
    });
    await fixture.componentInstance.accept();
    expect(api.acceptInvite).toHaveBeenCalledWith('abc');
    expect(activeTeam.refresh).toHaveBeenCalled();
    expect(activeTeam.select).toHaveBeenCalledWith('team-1');
  });

  it('explains an invalid code', async () => {
    api.getInvite.mockRejectedValue(new Error('not_found'));
    fixture = TestBed.createComponent(InvitePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('not valid');
  });

  it('treats a missing code as invalid', async () => {
    const emptyApi = createSpyObj<ApiClientService>('ApiClientService', ['getInvite', 'acceptInvite']);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [InvitePageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: emptyApi },
        { provide: ActiveTeamService, useValue: activeTeam },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => '' } } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InvitePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.error()).toContain('not valid');
    expect(emptyApi.getInvite).not.toHaveBeenCalled();
  });

  it('ignores a second accept while a join is in flight', async () => {
    let finish: (value: never) => void = () => undefined;
    api.acceptInvite.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const first = fixture.componentInstance.accept();
    await fixture.componentInstance.accept();
    expect(api.acceptInvite).toHaveBeenCalledTimes(1);
    finish({ teamId: 'team-1' } as never);
    await first;
  });

  it('does not accept when the route has no code param', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [InvitePageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: api },
        { provide: ActiveTeamService, useValue: activeTeam },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InvitePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.componentInstance.accept();
    expect(fixture.componentInstance.error()).toContain('not valid');
    expect(api.acceptInvite).not.toHaveBeenCalled();
  });

  it('surfaces accept failures without leaving joining stuck', async () => {
    api.acceptInvite.mockRejectedValue(new Error('forbidden'));
    await fixture.componentInstance.accept();
    expect(fixture.componentInstance.error()).toContain('cannot use');
    expect(fixture.componentInstance.joining()).toBe(false);
  });
});
