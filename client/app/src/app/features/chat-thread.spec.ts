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
      'presignUpload',
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
    api.sendMessage.mockImplementation(async (chatId: string, body: { body: string; attachmentKeys?: string[] }) => ({
      messageId: 'sent-1',
      chatId,
      senderId: 'u1',
      senderDisplayName: 'Ada Player',
      body: body.body,
      ...(body.attachmentKeys !== undefined ? { attachmentKeys: body.attachmentKeys } : {}),
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
    expect(api.sendMessage).toHaveBeenCalledWith('chat-1', { body: 'Hello team' });
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

  it('uploads a photo, sends it, and loads attachment urls', async () => {
    const component = fixture.componentInstance;
    api.presignUpload.mockResolvedValue({
      uploadUrl: 'https://upload.example/put',
      objectKey: 'uploads/u1/chat.png',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:preview'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    const file = new File(['img'], 'chat.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    await component.onPhotoSelected({ target: input } as unknown as Event);
    expect(component.pendingAttachments()).toEqual([
      { key: 'uploads/u1/chat.png', previewUrl: 'blob:preview' },
    ]);

    await component.send();
    expect(api.sendMessage).toHaveBeenCalledWith('chat-1', {
      body: '',
      attachmentKeys: ['uploads/u1/chat.png'],
    });
    expect(component.pendingAttachments()).toEqual([]);

    api.listMessages.mockResolvedValue({
      messages: [
        {
          messageId: 'm-photo',
          chatId: 'chat-1',
          senderId: 'u1',
          senderDisplayName: 'Ada Player',
          body: '',
          attachmentKeys: ['uploads/u1/chat.png'],
          createdAt: '2026-10-05T21:00:00.000Z',
        },
      ],
    });
    api.presignDownload.mockResolvedValue({
      downloadUrl: 'https://cdn.example/chat.png',
      objectKey: 'uploads/u1/chat.png',
    });
    fixture = TestBed.createComponent(ChatThreadPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.attachmentUrl('uploads/u1/chat.png')).toBe(
      'https://cdn.example/chat.png',
    );
  });

  it('rejects bad chat photo types and surfaces upload failures', async () => {
    const component = fixture.componentInstance;
    const bad = new File(['x'], 'notes.txt', { type: 'text/plain' });
    const badInput = document.createElement('input');
    Object.defineProperty(badInput, 'files', { value: [bad] });
    await component.onPhotoSelected({ target: badInput } as unknown as Event);
    expect(component.attachError()).toBe('errors.profile.badImageType');
    expect(api.presignUpload).not.toHaveBeenCalled();

    api.presignUpload.mockRejectedValue(new Error('fail'));
    const file = new File(['img'], 'chat.png', { type: 'image/png' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    await component.onPhotoSelected({ target: input } as unknown as Event);
    expect(component.attachError()).toBe('chats.attachFailed');
  });
});
