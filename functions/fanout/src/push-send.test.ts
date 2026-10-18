/**
 * Expo and Web Push payload delivery.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn();

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

const { sendDevicePushes } = await import('./push-send.js');

describe('sendDevicePushes', () => {
  afterEach(() => {
    sendNotification.mockReset();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    vi.unstubAllGlobals();
  });

  it('posts iOS and Android tokens to Expo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendDevicePushes({
      title: 'Join request',
      body: 'Ada asked to join Hawks',
      data: { type: 'join_requested' },
      devices: [
        { token: 'ExponentPushToken[ios]', platform: 'ios' },
        { token: 'ExponentPushToken[and]', platform: 'android' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Array<{ to: string; title: string }>;
    expect(body).toEqual([
      expect.objectContaining({ to: 'ExponentPushToken[ios]', title: 'Join request' }),
      expect.objectContaining({ to: 'ExponentPushToken[and]', body: 'Ada asked to join Hawks' }),
    ]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends a Web Push subscription when VAPID keys are set', async () => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.VAPID_SUBJECT = 'mailto:push@gameplan.local';
    sendNotification.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn());

    const subscription = {
      endpoint: 'https://push.example/sub',
      keys: { p256dh: 'p256', auth: 'auth' },
    };
    await sendDevicePushes({
      title: 'Join request',
      body: 'Ada asked to join Hawks',
      data: { type: 'join_requested' },
      devices: [{ token: JSON.stringify(subscription), platform: 'web' }],
    });

    expect(sendNotification).toHaveBeenCalledWith(
      subscription,
      expect.stringContaining('Ada asked to join Hawks'),
    );
  });

  const message = { title: 'Join request', body: 'Ada asked to join Hawks', data: {} };
  const webDevice = (token: unknown) => ({
    token: typeof token === 'string' ? token : JSON.stringify(token),
    platform: 'web',
  });
  const subscription = { endpoint: 'https://push.example/sub', keys: { p256dh: 'p256', auth: 'auth' } };
  const setVapid = (): void => {
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    process.env.VAPID_SUBJECT = 'mailto:push@gameplan.local';
  };

  it('logs an Expo rejection or network failure without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const native = [{ token: 'ExponentPushToken[ios]', platform: 'ios' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await sendDevicePushes({ ...message, devices: native });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await sendDevicePushes({ ...message, devices: native });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('reset'));
    await sendDevicePushes({ ...message, devices: native });

    const logged = warn.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(logged).toEqual([
      expect.objectContaining({ event: 'expo_push_failed', status: 500 }),
      expect.objectContaining({ event: 'expo_push_failed', error: 'offline' }),
      expect.objectContaining({ event: 'expo_push_failed', error: 'reset' }),
    ]);
    warn.mockRestore();
  });

  it('skips web devices when any VAPID setting is missing', async () => {
    await sendDevicePushes({ ...message, devices: [webDevice(subscription)] });
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_SUBJECT = 'mailto:push@gameplan.local';
    await sendDevicePushes({ ...message, devices: [webDevice(subscription)] });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('skips stored tokens that are not Web Push subscriptions', async () => {
    setVapid();
    await sendDevicePushes({
      ...message,
      devices: [
        webDevice('not json'),
        webDevice({ keys: subscription.keys }),
        webDevice({ endpoint: '', keys: subscription.keys }),
        webDevice({ endpoint: subscription.endpoint }),
        webDevice({ endpoint: subscription.endpoint, keys: { p256dh: 'p256' } }),
      ],
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('logs a failed Web Push send and keeps going', async () => {
    setVapid();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sendNotification.mockRejectedValueOnce(new Error('gone')).mockRejectedValueOnce('timeout');
    await sendDevicePushes({ ...message, devices: [webDevice(subscription), webDevice(subscription)] });
    const logged = warn.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(logged).toEqual([
      expect.objectContaining({ event: 'web_push_failed', error: 'gone' }),
      expect.objectContaining({ event: 'web_push_failed', error: 'timeout' }),
    ]);
    warn.mockRestore();
  });
});
