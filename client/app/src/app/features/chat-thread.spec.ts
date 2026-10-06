import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ChatThreadPageComponent } from './chats';
import { ApiClient } from '../core/api-client';
import { LiveSocket } from '../core/live-socket';

describe('ChatThreadPageComponent', () => {
  let fixture: ComponentFixture<ChatThreadPageComponent>;

  beforeEach(async () => {
    const api = jasmine.createSpyObj<ApiClient>('ApiClient', ['listMessages', 'sendMessage']);
    api.listMessages.and.resolveTo({ messages: [] });

    await TestBed.configureTestingModule({
      imports: [ChatThreadPageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'chat-1' } } },
        },
        {
          provide: LiveSocket,
          useValue: jasmine.createSpyObj<LiveSocket>('LiveSocket', ['subscribe']),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatThreadPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders the chat thread shell', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Chat');
    expect(text).toContain('Send');
  });
});
