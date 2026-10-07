import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CreatePrivateChatComponent } from './create-private-chat';
import { ApiClientService } from '../core/api-client.service';
import { ModalRef } from '../core/modal.service';
import { provideTranslocoForTests } from '../../testing/transloco';

describe('CreatePrivateChatComponent', () => {
  let fixture: ComponentFixture<CreatePrivateChatComponent>;
  let api: SpyObj<ApiClientService>;
  let modal: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', [
      'searchChatUser',
      'createPrivateChat',
    ]);
    Object.defineProperty(api, 'user', {
      get: () => ({ userId: 'me', email: 'me@example.com', displayName: 'Me' }),
      configurable: true,
    });
    modal = { close: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [CreatePrivateChatComponent],
      providers: [
        ...provideTranslocoForTests(),
        { provide: ApiClientService, useValue: api },
        { provide: ModalRef, useValue: modal },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CreatePrivateChatComponent);
    fixture.detectChanges();
  });

  it('searches by email and creates a private chat', async () => {
    const component = fixture.componentInstance;
    api.searchChatUser.mockResolvedValue({
      userId: 'u2',
      email: 'ada@example.com',
      displayName: 'Ada',
      accountKind: 'adult',
    });
    api.createPrivateChat.mockResolvedValue({
      chatId: 'p1',
      kind: 'private',
      name: 'Private chat',
      createdBy: 'me',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    component.email = 'ada@example.com';
    await component.search();
    expect(component.match()?.userId).toBe('u2');
    await component.create();
    expect(api.createPrivateChat).toHaveBeenCalledWith(['u2']);
    expect(modal.close).toHaveBeenCalledWith('p1');
  });

  it('rejects chatting with yourself', async () => {
    api.searchChatUser.mockResolvedValue({
      userId: 'me',
      email: 'me@example.com',
      displayName: 'Me',
      accountKind: 'adult',
    });
    fixture.componentInstance.email = 'me@example.com';
    await fixture.componentInstance.search();
    expect(fixture.componentInstance.error()).toBe('chats.cannotChatSelf');
    expect(fixture.componentInstance.match()).toBeUndefined();
  });
});
