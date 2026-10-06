import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ChatThreadPageComponent } from './chats';
import { ApiClient } from '../core/api-client';
import { LiveSocket } from '../core/live-socket';

describe('ChatThreadPageComponent', () => {
  let fixture: ComponentFixture<ChatThreadPageComponent>;

  beforeEach(async () => {
    const api = jasmine.createSpyObj<ApiClient>('ApiClient', [
      'listChats',
      'listMessages',
      'sendMessage',
      'presignDownload',
    ]);
    api.listChats.and.resolveTo([
      {
        chatId: 'chat-1',
        kind: 'default',
        name: 'Varsity',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    api.listMessages.and.resolveTo({
      messages: [
        {
          messageId: 'm1',
          chatId: 'chat-1',
          senderId: 'u1',
          senderDisplayName: 'Ada Player',
          senderPhotoKey: 'uploads/u1/photo',
          body: 'See you at practice',
          createdAt: '2026-10-05T18:00:00.000Z',
        },
        {
          messageId: 'm2',
          chatId: 'chat-1',
          senderId: 'u2',
          senderDisplayName: 'Bo Coach',
          body: 'On my way',
          createdAt: '2026-10-05T17:00:00.000Z',
        },
      ],
    });
    api.presignDownload.and.resolveTo({
      downloadUrl: 'https://cdn.example/ada.jpg',
      objectKey: 'uploads/u1/photo',
    });

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

  it('renders the chat name in the header', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Varsity');
    expect(text).toContain('Send');
  });

  it('shows the sender name and time only after that message is clicked', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('See you at practice');
    expect(root.textContent).toContain('BC');
    expect(root.textContent).not.toContain('Ada Player');
    expect(root.textContent).not.toContain('Bo Coach');
    expect(root.querySelector('.chat-message-meta')).toBeNull();
    const img = root.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example/ada.jpg');

    const messages = root.querySelectorAll('button.chat-message');
    (messages[0] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(root.textContent).toContain('Ada Player');
    expect(root.querySelector('.chat-message-meta .muted')?.textContent?.trim().length).toBeGreaterThan(
      0,
    );
    expect(root.textContent).not.toContain('Bo Coach');

    (messages[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.textContent).not.toContain('Ada Player');
  });
});
