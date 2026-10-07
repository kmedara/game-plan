import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { ChatsPageComponent } from './chats';
import { ActiveTeamService } from '../core/active-team.service';
import { ApiClientService } from '../core/api-client.service';
import { ModalService } from '../core/modal.service';
import { provideTranslocoForTests } from '../../testing/transloco';

describe('ChatsPageComponent', () => {
  let fixture: ComponentFixture<ChatsPageComponent>;
  let api: SpyObj<ApiClientService>;
  let modal: SpyObj<ModalService>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let teamId: ReturnType<typeof signal<string | undefined>>;
  let activeTeam: {
    teamId: ReturnType<typeof signal<string | undefined>>;
    teams: ReturnType<typeof signal<unknown[]>>;
    active: ReturnType<typeof signal<{ teamId: string; role: string } | undefined>>;
    refresh: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', [
      'listChats',
      'getPermissions',
    ]);
    api.listChats.mockResolvedValue([]);
    api.getPermissions.mockResolvedValue({ roles: [] });
    modal = createSpyObj<ModalService>('ModalService', ['open']);
    teamId = signal<string | undefined>('t1');
    activeTeam = {
      teamId,
      teams: signal([{ teamId: 't1', name: 'Seacoast', timeZone: 'UTC', role: 'team_admin' }]),
      active: signal({ teamId: 't1', role: 'team_admin' }),
      refresh: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ChatsPageComponent],
      providers: [
        provideRouter([]),
        ...provideTranslocoForTests(),
        { provide: ApiClientService, useValue: api },
        { provide: ActiveTeamService, useValue: activeTeam },
        { provide: ModalService, useValue: modal },
      ],
    }).compileComponents();

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ChatsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('shows empty state when there is no active team and no private chats', async () => {
    teamId.set(undefined);
    activeTeam.active.set(undefined);
    fixture = TestBed.createComponent(ChatsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Join or create a team to open the team chat');
  });

  it('filters team chats to the active team and keeps private chats', async () => {
    api.listChats.mockResolvedValue([
      {
        chatId: 'c1',
        kind: 'default',
        name: 'Seacoast team',
        teamId: 't1',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      {
        chatId: 'c2',
        kind: 'channel',
        name: 'Varsity',
        teamId: 't1',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      {
        chatId: 'c3',
        kind: 'default',
        name: 'Other team',
        teamId: 't2',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      {
        chatId: 'c4',
        kind: 'channel',
        name: 'Other channel',
        teamId: 't2',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      {
        chatId: 'c5',
        kind: 'private',
        name: 'Ada',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    fixture = TestBed.createComponent(ChatsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.onATeam()).toBe(true);
    expect(component.teamGroups()[0]?.items.map((c) => c.chatId)).toEqual(['c1']);
    expect(component.teamGroups()[1]?.items.map((c) => c.chatId)).toEqual(['c2']);
    expect(component.privateChats().map((c) => c.chatId)).toEqual(['c5']);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Seacoast team');
    expect(text).toContain('Varsity');
    expect(text).toContain('Ada');
    expect(text).not.toContain('Other team');
    expect(text).not.toContain('Other channel');
  });

  it('enables the channel option when the role can create channels', async () => {
    api.getPermissions.mockResolvedValue({
      roles: [{ role: 'team_admin', permissions: ['create_team_channels'] }],
    });
    fixture = TestBed.createComponent(ChatsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.canCreateChannel()).toBe(true);
  });

  it('opens private chat creation from the FAB chooser and navigates', async () => {
    modal.open
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce('chat-new');
    await fixture.componentInstance.startAdd();
    expect(modal.open).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith(['/chats', 'chat-new']);
  });

  it('opens channel creation when chosen and a team is active', async () => {
    api.getPermissions.mockResolvedValue({
      roles: [{ role: 'team_admin', permissions: ['create_team_channels'] }],
    });
    fixture = TestBed.createComponent(ChatsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    modal.open.mockResolvedValueOnce('channel').mockResolvedValueOnce('chan-1');
    await fixture.componentInstance.startAdd();
    expect(modal.open).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith(['/chats', 'chan-1']);
  });
});
