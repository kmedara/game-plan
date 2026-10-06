import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ApiClient } from '../core/api-client';
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
  });
});

describe('InvitePageComponent', () => {
  let fixture: ComponentFixture<InvitePageComponent>;
  let api: jasmine.SpyObj<ApiClient>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiClient>('ApiClient', ['getInvite', 'acceptInvite']);
    api.getInvite.and.resolveTo({
      code: 'abc',
      teamId: 'team-1',
      teamName: 'Seacoast',
      role: 'player',
      createdAt: '2026-10-05T00:00:00.000Z',
    });

    await TestBed.configureTestingModule({
      imports: [InvitePageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
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

    api.acceptInvite.and.resolveTo({
      teamId: 'team-1',
      name: 'Seacoast',
      timeZone: 'America/New_York',
      defaultChatId: 'chat-1',
      role: 'player',
      joinedAt: '2026-10-05T00:00:00.000Z',
    });
    await fixture.componentInstance.accept();
    expect(api.acceptInvite).toHaveBeenCalledWith('abc');
  });

  it('explains an invalid code', async () => {
    api.getInvite.and.rejectWith(new Error('not_found'));
    fixture = TestBed.createComponent(InvitePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('not valid');
  });
});
