/**
 * Registers the device token with the media API so fan-out can alert offline.
 */

import { Platform } from 'react-native';
import type { ApiClient } from './api';

/**
 * Requests permission and stores the native push token.
 *
 * Web has no device token path and returns immediately. The notifications
 * package is loaded only on device so web server rendering never touches it.
 *
 * @param api - The signed-in API client.
 */
export const registerPush = async (api: ApiClient): Promise<void> => {
  if (Platform.OS === 'web') return;
  const Notifications = await import('expo-notifications');
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return;
  const token = await Notifications.getDevicePushTokenAsync();
  const value = typeof token.data === 'string' ? token.data : '';
  if (value.length === 0) return;
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const deviceId = `${platform}-${value.slice(0, 24)}`;
  try {
    await api.registerDevice(deviceId, value, platform);
  } catch (error) {
    console.warn('device registration failed', error);
  }
};
