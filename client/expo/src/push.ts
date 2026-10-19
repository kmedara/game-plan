/**
 * Registers the device token with the media API so fan-out can alert offline.
 *
 * Asking for permission happens only from a tap (sign-in or the profile
 * button); iPhone Safari ignores a prompt that is not. Every launch then calls
 * {@link refreshPushRegistration}, which re-saves the token without prompting.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ApiClient } from './api';
import { config } from './config';

/**
 * Where this device stands on notifications.
 *
 * `needs-install` is iPhone or iPad Safari in a normal tab: Apple only allows
 * web notifications once the site is added to the Home Screen.
 */
export type PushStatus = 'native' | 'unsupported' | 'needs-install' | 'prompt' | 'granted' | 'denied';

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

/**
 * Reports whether notifications are on, can be turned on, or need the Home Screen first.
 *
 * @returns The status for this device.
 */
export const pushStatus = (): PushStatus => {
  if (Platform.OS !== 'web') return 'native';
  if (isAppleMobileBrowser() && !isInstalledWebApp()) return 'needs-install';
  if (!webPushAvailable()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'prompt';
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
  const projectId =
    config.easProjectId ||
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ||
    '';
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
      return 'native';
    }
    const status = pushStatus();
    if (status !== 'prompt' && status !== 'granted') return status;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return pushStatus();
    await saveWebSubscription(api);
    return 'granted';
  } catch (error) {
    console.warn('device registration failed', error);
    return pushStatus();
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
    if (pushStatus() === 'granted') await saveWebSubscription(api);
  } catch (error) {
    console.warn('device registration failed', error);
  }
};
