import { createSpyObj, type SpyObj } from '../../testing/spy';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService } from './api-client.service';
import { PushRegistrationService } from './push-registration.service';

const capacitorState = vi.hoisted(() => ({
  native: false,
  platform: 'web',
}));

const pushMocks = vi.hoisted(() => ({
  requestPermissions: vi.fn(),
  register: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorState.native,
    getPlatform: () => capacitorState.platform,
  },
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: (...args: unknown[]) => pushMocks.requestPermissions(...args),
    register: (...args: unknown[]) => pushMocks.register(...args),
    addListener: (...args: unknown[]) => pushMocks.addListener(...args),
  },
}));

describe('PushRegistrationService', () => {
  let api: SpyObj<ApiClientService>;
  let service: PushRegistrationService;

  beforeEach(() => {
    capacitorState.native = false;
    capacitorState.platform = 'web';
    pushMocks.requestPermissions.mockReset();
    pushMocks.register.mockReset();
    pushMocks.addListener.mockReset();
    api = createSpyObj<ApiClientService>('ApiClientService', ['registerDevice']);
    api.registerDevice.mockResolvedValue({ deviceId: 'd1', platform: 'ios' } as never);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiClientService, useValue: api }],
    });
    service = TestBed.inject(PushRegistrationService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips registration on web', async () => {
    await service.register();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('stops when permission is denied', async () => {
    capacitorState.native = true;
    pushMocks.requestPermissions.mockResolvedValue({ receive: 'denied' });
    await service.register();
    expect(api.registerDevice).not.toHaveBeenCalled();
  });

  it('registers an iOS device token', async () => {
    capacitorState.native = true;
    capacitorState.platform = 'ios';
    pushMocks.requestPermissions.mockResolvedValue({ receive: 'granted' });
    pushMocks.register.mockResolvedValue(undefined);
    pushMocks.addListener.mockImplementation(async (_event: string, cb: (token: { value: string }) => Promise<void>) => {
      await cb({ value: 'token-value-12345678901234567890' });
      return { remove: async () => undefined };
    });

    await service.register();
    expect(api.registerDevice).toHaveBeenCalledWith(
      expect.stringMatching(/^ios-/),
      'token-value-12345678901234567890',
      'ios',
    );
  });

  it('warns when device registration fails', async () => {
    capacitorState.native = true;
    capacitorState.platform = 'android';
    pushMocks.requestPermissions.mockResolvedValue({ receive: 'granted' });
    pushMocks.register.mockResolvedValue(undefined);
    api.registerDevice.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    pushMocks.addListener.mockImplementation(async (_event: string, cb: (token: { value: string }) => Promise<void>) => {
      await cb({ value: 'android-token-abcdefghijklmnop' });
      return { remove: async () => undefined };
    });

    await service.register();
    expect(warn).toHaveBeenCalled();
  });
});
