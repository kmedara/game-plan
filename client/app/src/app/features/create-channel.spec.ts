import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CreateChannelComponent } from './create-channel';
import { ApiClientService } from '../core/api-client.service';
import { ModalRef } from '../core/modal.service';
import { provideTranslocoForTests } from '../../testing/transloco';

describe('CreateChannelComponent', () => {
  let fixture: ComponentFixture<CreateChannelComponent>;
  let api: SpyObj<ApiClientService>;
  let modal: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', ['createTeamChannel']);
    modal = { close: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [CreateChannelComponent],
      providers: [
        ...provideTranslocoForTests(),
        { provide: ApiClientService, useValue: api },
        { provide: ModalRef, useValue: modal },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CreateChannelComponent);
    fixture.componentRef.setInput('teamId', 't1');
    fixture.detectChanges();
  });

  it('requires a name before creating', async () => {
    await fixture.componentInstance.create();
    expect(api.createTeamChannel).not.toHaveBeenCalled();
    expect(fixture.componentInstance.error()).toBe('chats.channelNameRequired');
  });

  it('creates a channel and closes with its id', async () => {
    api.createTeamChannel.mockResolvedValue({
      chatId: 'ch1',
      kind: 'channel',
      name: 'Parents',
      teamId: 't1',
      createdBy: 'u1',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    fixture.componentInstance.name = 'Parents';
    await fixture.componentInstance.create();
    expect(api.createTeamChannel).toHaveBeenCalledWith('t1', 'Parents');
    expect(modal.close).toHaveBeenCalledWith('ch1');
  });
});
