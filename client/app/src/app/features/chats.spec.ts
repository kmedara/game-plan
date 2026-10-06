import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChatsPageComponent } from './chats';
import { ApiClient } from '../core/api-client';

describe('ChatsPageComponent', () => {
  let fixture: ComponentFixture<ChatsPageComponent>;
  let api: jasmine.SpyObj<ApiClient>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiClient>('ApiClient', ['listChats', 'listTeams']);
    api.listChats.and.resolveTo([]);
    api.listTeams.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [ChatsPageComponent],
      providers: [provideRouter([]), { provide: ApiClient, useValue: api }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('hides team default chat when the user is not on a team', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Join or create a team to open the team default chat');
    expect(text).not.toContain('Team default');
  });
});
