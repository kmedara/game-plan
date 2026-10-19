/**
 * Registers the device token with the media API so fan-out can alert offline.
 *
 * Asking for permission happens only from a tap on the notification banner or
 * the profile button: iPhone Safari ignores a prompt that is not, and iOS
 * shows its system dialog only once, so it is worth a sentence of context
 * first. Every launch calls {@link refreshPushRegistration}, which re-saves the
 * token without prompting.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ApiClient } from './api';
import { config } from './config';

/**
 * Where this device stands on notifications.
 *
 * `prompt` means no choice is recorded yet. `needs-install` is iPhone or iPad
 * Safari in a normal tab: Apple only allows web notifications once the site is
 * added to the Home Screen.
 */
export type PushStatus = 'unsupported' | 'needs-install' | 'prompt' | 'granted' | 'denied';

/**
 * Converts a base64url VAPID public key into the bytes PushManager expects.
 *
 * @param value - The URL-safe base64 public key.
 * @returns The key bytes.
 */
const vapidKeyBytes = (value: string): Uint8Array => {
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = globalThis.atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/** Whether this is an iPhone or iPad browser (iPadOS reports itself as a Mac with touch). */
const isAppleMobileBrowser = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/u.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1));

/** Whether the site was opened from the Home Screen rather than a browser tab. */
const isInstalledWebApp = (): boolean =>
  (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches === true) ||
  (typeof navigator !== 'undefined' && (navigator as { standalone?: boolean }).standalone === true);

/** Whether this browser can do Web Push at all. */
const webPushAvailable = (): boolean =>
  config.vapidPublicKey.length > 0 &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in globalThis &&
  'Notification' in globalThis;

/** The Expo project id push tokens are issued for, or an empty string. */
const easProjectId = (): string =>
  config.easProjectId ||
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ||
  '';

/**
 * Reports whether website notifications are on, can be turned on, or need the Home Screen first.
 *
 * @returns The status for this browser.
 */
const webPushStatus = (): PushStatus => {
  if (isAppleMobileBrowser() && !isInstalledWebApp()) return 'needs-install';
  if (!webPushAvailable()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'prompt';
};

/**
 * Reports whether notifications are on, blocked, or still undecided on this device.
 *
 * @returns The status for this phone or browser.
 */
export const loadPushStatus = async (): Promise<PushStatus> => {
  if (Platform.OS === 'web') return webPushStatus();
  if (easProjectId().length === 0) return 'unsupported';
  try {
    const Notifications = await import('expo-notifications');
    const permission = await Notifications.getPermissionsAsync();
    if (permission.granted) return 'granted';
    // iOS will not show its dialog again once declined; Android may.
    return permission.canAskAgain ? 'prompt' : 'denied';
  } catch {
    return 'unsupported';
  }
};

/**
 * Subscribes this browser for Web Push and stores the subscription.
 *
 * An existing subscription is reused, so calling this on every launch is cheap.
 *
 * @param api - The signed-in API client.
 */
const saveWebSubscription = async (api: ApiClient): Promise<void> => {
  const registration = await navigator.serviceWorker.register('/sw.js');
  const key = vapidKeyBytes(config.vapidPublicKey);
  const applicationServerKey = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));
  const json = subscription.toJSON();
  const token = JSON.stringify(json);
  const endpoint = json.endpoint ?? token;
  const deviceId = `web-${endpoint.slice(-32)}`;
  await api.registerDevice(deviceId, token, 'web');
};

/**
 * Stores the Expo push token for this phone.
 *
 * @param api - The signed-in API client.
 * @param prompt - Ask for permission when it has not been decided yet.
 */
const saveNativeToken = async (api: ApiClient, prompt: boolean): Promise<void> => {
  const projectId = easProjectId();
  if (projectId.length === 0) return;
  const Notifications = await import('expo-notifications');
  const permission = prompt ? await Notifications.requestPermissionsAsync() : await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const value = token.data;
  if (value.length === 0) return;
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const deviceId = `${platform}-${value.slice(0, 24)}`;
  await api.registerDevice(deviceId, value, platform);
};

/**
 * Asks for permission and stores the native or web push token.
 *
 * Call it straight from a tap. On the web the permission prompt is the first
 * thing awaited, which Safari requires.
 *
 * @param api - The signed-in API client.
 * @returns The status after asking.
 */
export const registerPush = async (api: ApiClient): Promise<PushStatus> => {
  try {
    if (Platform.OS !== 'web') {
      await saveNativeToken(api, true);
      return await loadPushStatus();
    }
    const status = webPushStatus();
    if (status !== 'prompt' && status !== 'granted') return status;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return webPushStatus();
    await saveWebSubscription(api);
    return 'granted';
  } catch (error) {
    console.warn('device registration failed', error);
    return loadPushStatus();
  }
};

/**
 * Re-saves the token when permission was already given. Never prompts.
 *
 * A browser that cleared its subscription, or a session restored without
 * signing in again, gets registered here.
 *
 * @param api - The signed-in API client.
 */
export const refreshPushRegistration = async (api: ApiClient): Promise<void> => {
  try {
    if (Platform.OS !== 'web') {
      await saveNativeToken(api, false);
      return;
    }
    if (webPushStatus() === 'granted') await saveWebSubscription(api);
  } catch (error) {
    console.warn('device registration failed', error);
  }
};
