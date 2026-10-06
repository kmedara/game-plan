import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ChatThreadPageComponent } from './chats';
import { ApiClientService } from '../core/api-client.service';
import { LiveSocketService } from '../core/live-socket.service';

describe('ChatThreadPageComponent', () => {
  let fixture: ComponentFixture<ChatThreadPageComponent>;
  let api: SpyObj<ApiClientService>;
  let liveHandler: ((event: unknown) => void) | undefined;

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', [
      'listChats',
      'listMessages',
      'sendMessage',
      'presignDownload',
    ]);
    api.listChats.mockResolvedValue([
      {
        chatId: 'chat-1',
        kind: 'default',
        name: 'Varsity',
        createdBy: 'u1',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    api.listMessages.mockResolvedValue({
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
    api.sendMessage.mockImplementation(async (chatId: string, body: string) => ({
      messageId: 'sent-1',
      chatId,
      senderId: 'u1',
      senderDisplayName: 'Ada Player',
      body,
      createdAt: '2026-10-05T20:00:00.000Z',
    }));
    api.presignDownload.mockResolvedValue({
      downloadUrl: 'https://cdn.example/ada.jpg',
      objectKey: 'uploads/u1/photo',
    });

    await TestBed.configureTestingModule({
      imports: [ChatThreadPageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'chat-1' } } },
        },
        {
          provide: LiveSocketService,
          useValue: {
            subscribe: (handler: (event: unknown) => void) => {
              liveHandler = handler;
            },
          },
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

  it('merges live chat messages and sends on Enter', async () => {
    const component = fixture.componentInstance;
    liveHandler?.({
      type: 'chat_message',
      chatId: 'chat-1',
      messageId: 'live-1',
      senderId: 'u9',
      senderDisplayName: 'Live Sender',
      senderPhotoKey: 'uploads/live/photo',
      body: 'Live ping',
      attachmentKeys: [],
      createdAt: '2026-10-05T19:00:00.000Z',
    });
    fixture.detectChanges();
    expect(component.messages()[0]?.body).toBe('Live ping');
    expect(component.messages()[0]?.senderPhotoKey).toBe('uploads/live/photo');
    expect(component.senderName(component.messages()[0]!)).toBe('Live Sender');

    liveHandler?.({
      type: 'chat_message',
      chatId: 'chat-1',
      messageId: 'live-2',
      senderId: 'u8',
      body: 'No photo',
      attachmentKeys: [],
      createdAt: '2026-10-05T19:01:00.000Z',
    });
    fixture.detectChanges();
    expect(component.messages()[0]?.senderPhotoKey).toBeUndefined();
    expect(component.senderName(component.messages()[0]!)).toBe('Player');

    component.draft = 'Hello team';
    component.submitDraft(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(api.sendMessage).toHaveBeenCalledWith('chat-1', 'Hello team');
    expect(component.draft).toBe('');

    component.submitDraft(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores blank sends and tolerates chat list lookup failures', async () => {
    api.listChats.mockRejectedValue(new Error('offline'));
    fixture = TestBed.createComponent(ChatThreadPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.chatName()).toBe('');

    await fixture.componentInstance.send();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('leaves the title blank when the chat is not in the list', async () => {
    api.listChats.mockResolvedValue([]);
    fixture = TestBed.createComponent(ChatThreadPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.chatName()).toBe('');
  });

  it('falls back to an empty chat id when the route has no chatId param', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ChatThreadPageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
        { provide: LiveSocketService, useValue: { subscribe: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ChatThreadPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.listMessages).toHaveBeenLastCalledWith('');
  });

  it('keeps initials when a photo presign fails', async () => {
    api.presignDownload.mockRejectedValue(new Error('denied'));
    api.listMessages.mockResolvedValue({
      messages: [
        {
          messageId: 'm3',
          chatId: 'chat-1',
          senderId: 'u3',
          senderDisplayName: '   ',
          senderPhotoKey: 'uploads/u3/photo',
          body: 'No name',
          createdAt: '2026-10-05T16:00:00.000Z',
        },
      ],
    });
    fixture = TestBed.createComponent(ChatThreadPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.initials(fixture.componentInstance.messages()[0]!)).toBe('?');
    expect(fixture.componentInstance.photoUrl(fixture.componentInstance.messages()[0]!)).toBeUndefined();
  });
});
