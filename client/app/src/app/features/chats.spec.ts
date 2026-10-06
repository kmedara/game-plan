import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChatsPageComponent } from './chats';
import { ApiClientService } from '../core/api-client.service';

describe('ChatsPageComponent', () => {
  let fixture: ComponentFixture<ChatsPageComponent>;
  let api: SpyObj<ApiClientService>;

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', ['listChats', 'listTeams']);
    api.listChats.mockResolvedValue([]);
    api.listTeams.mockResolvedValue([]);

    await TestBed.configureTestingModule({
      imports: [ChatsPageComponent],
      providers: [provideRouter([]), { provide: ApiClientService, useValue: api }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('hides team default chat when the user is not on a team', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Join or create a team to open the team chat');
    expect(text).not.toContain('Team default');
  });

  it('groups team and channel chats when the user is on a team', async () => {
    api.listTeams.mockResolvedValue([
      { teamId: 't1', name: 'Seacoast', timeZone: 'UTC', role: 'player' },
    ]);
    api.listChats.mockResolvedValue([
      {
        chatId: 'c1',
        kind: 'default',
        name: 'Team default',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      {
        chatId: 'c2',
        kind: 'channel',
        name: 'Varsity',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      {
        chatId: 'c3',
        kind: 'private',
        name: 'Ada',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    fixture = TestBed.createComponent(ChatsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    expect(component.onATeam()).toBe(true);
    expect(component.teamGroups()[0]?.items).toHaveLength(1);
    expect(component.teamGroups()[1]?.items).toHaveLength(1);
    expect(component.privateChats()).toHaveLength(1);
  });
});
