/**
 * Sends stored device tokens through Expo (iOS and Android) and Web Push.
 */

import webpush from 'web-push';

/** Device row needed to address one push registration. */
export type PushDevice = {
  token: string;
  platform: string;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Reads VAPID settings when all three values are present.
 *
 * @returns The public key, private key, and subject, or `undefined`.
 */
const vapidConfig = (): { publicKey: string; privateKey: string; subject: string } | undefined => {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (
    publicKey === undefined ||
    publicKey.length === 0 ||
    privateKey === undefined ||
    privateKey.length === 0 ||
    subject === undefined ||
    subject.length === 0
  ) {
    return undefined;
  }
  return { publicKey, privateKey, subject };
};

/**
 * Parses a stored Web Push subscription.
 *
 * @param token - JSON stored at device registration.
 * @returns The subscription, or `undefined` when the token is not one.
 */
const webSubscription = (
  token: string,
): { endpoint: string; keys: { p256dh: string; auth: string } } | undefined => {
  try {
    const parsed = JSON.parse(token) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };
    if (typeof parsed.endpoint !== 'string' || parsed.endpoint.length === 0) return undefined;
    if (typeof parsed.keys?.p256dh !== 'string' || typeof parsed.keys.auth !== 'string') {
      return undefined;
    }
    return { endpoint: parsed.endpoint, keys: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth } };
  } catch {
    return undefined;
  }
};

/**
 * Delivers one notification to Expo tokens and Web Push subscriptions.
 *
 * Missing VAPID keys skip web devices. HTTP failures are logged and do not
 * throw, so one bad device does not fail the fan-out batch.
 *
 * @param input - Title, body, data payload, and the user's devices.
 */
export const sendDevicePushes = async (input: {
  title: string;
  body: string;
  data: unknown;
  devices: PushDevice[];
}): Promise<void> => {
  const native = input.devices.filter(
    (device) => device.platform === 'ios' || device.platform === 'android',
  );
  if (native.length > 0) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(
          native.map((device) => ({
            to: device.token,
            title: input.title,
            body: input.body,
            data: input.data,
          })),
        ),
      });
      if (!response.ok) {
        console.warn(
          JSON.stringify({ service: 'fanout', event: 'expo_push_failed', status: response.status }),
        );
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          service: 'fanout',
          event: 'expo_push_failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  const web = input.devices.filter((device) => device.platform === 'web');
  const vapid = vapidConfig();
  if (web.length === 0 || vapid === undefined) return;

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const payload = JSON.stringify({ title: input.title, body: input.body, data: input.data });
  await Promise.all(
    web.map(async (device) => {
      const subscription = webSubscription(device.token);
      if (subscription === undefined) return;
      try {
        await webpush.sendNotification(subscription, payload);
      } catch (error) {
        console.warn(
          JSON.stringify({
            service: 'fanout',
            event: 'web_push_failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }),
  );
};
