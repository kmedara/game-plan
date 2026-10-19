/**
 * Sends stored device tokens through Expo (iOS and Android) and Web Push.
 */

import webpush from 'web-push';
import { readSecret } from '../../lib/parameters.js';

/** Device row needed to address one push registration. */
export type PushDevice = {
  token: string;
  platform: string;
};

/** One Expo push ticket; only the fields read here. */
type ExpoTicket = { status?: string; details?: { error?: string } };

/**
 * Whether a Web Push failure means the subscription no longer exists.
 *
 * @param error - The `web-push` rejection.
 * @returns `true` for `404 Not Found` and `410 Gone`.
 */
const subscriptionGone = (error: unknown): boolean => {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return status === 404 || status === 410;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Reads VAPID settings when all three values are present.
 *
 * The public key and subject are not secret and come from the environment.
 * The private key comes from Parameter Store.
 *
 * @returns The public key, private key, and subject, or `undefined`.
 */
const vapidConfig = async (): Promise<
  { publicKey: string; privateKey: string; subject: string } | undefined
> => {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (publicKey === undefined || publicKey.length === 0 || subject === undefined || subject.length === 0) {
    return undefined;
  }
  const privateKey = await readSecret('VAPID_PRIVATE_KEY_PARAMETER', 'VAPID_PRIVATE_KEY');
  if (privateKey === undefined) return undefined;
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
 * @returns Devices the push service says no longer exist, so the caller can forget them.
 */
export const sendDevicePushes = async <Device extends PushDevice>(input: {
  title: string;
  body: string;
  data: unknown;
  devices: Device[];
}): Promise<Device[]> => {
  const gone: Device[] = [];
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
      } else {
        // Tickets come back in request order.
        const tickets = await response
          .json()
          .then((parsed: { data?: ExpoTicket[] }) => parsed.data ?? [])
          .catch((): ExpoTicket[] => []);
        tickets.forEach((ticket, index) => {
          const device = native[index];
          if (device !== undefined && ticket.details?.error === 'DeviceNotRegistered') gone.push(device);
        });
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
  if (web.length === 0) return gone;
  const vapid = await vapidConfig();
  if (vapid === undefined) return gone;

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const payload = JSON.stringify({ title: input.title, body: input.body, data: input.data });
  await Promise.all(
    web.map(async (device) => {
      const subscription = webSubscription(device.token);
      if (subscription === undefined) return;
      try {
        await webpush.sendNotification(subscription, payload);
      } catch (error) {
        if (subscriptionGone(error)) {
          gone.push(device);
          return;
        }
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
  return gone;
};
