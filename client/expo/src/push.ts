/**
 * Registers the device token with the media API so fan-out can alert offline.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ApiClient } from './api';
import { config } from './config';

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

/**
 * Subscribes this browser for Web Push and stores the subscription.
 *
 * @param api - The signed-in API client.
 */
const registerWebPush = async (api: ApiClient): Promise<void> => {
  if (config.vapidPublicKey.length === 0) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!('PushManager' in globalThis)) return;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;
  const registration = await navigator.serviceWorker.register('/sw.js');
  const key = vapidKeyBytes(config.vapidPublicKey);
  const applicationServerKey = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  const json = subscription.toJSON();
  const token = JSON.stringify(json);
  const endpoint = json.endpoint ?? token;
  const deviceId = `web-${endpoint.slice(-32)}`;
  await api.registerDevice(deviceId, token, 'web');
};

/**
 * Requests permission and stores the native or web push token.
 *
 * @param api - The signed-in API client.
 */
export const registerPush = async (api: ApiClient): Promise<void> => {
  try {
    if (Platform.OS === 'web') {
      await registerWebPush(api);
      return;
    }
    const projectId =
      config.easProjectId ||
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ||
      '';
    if (projectId.length === 0) return;
    const Notifications = await import('expo-notifications');
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    const value = token.data;
    if (value.length === 0) return;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const deviceId = `${platform}-${value.slice(0, 24)}`;
    await api.registerDevice(deviceId, value, platform);
  } catch (error) {
    console.warn('device registration failed', error);
  }
};
