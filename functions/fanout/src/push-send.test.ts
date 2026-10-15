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
});
