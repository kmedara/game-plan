/**
 * Registers for push when running inside Capacitor, and stores the device token
 * so fan-out can alert when no WebSocket is open.
 */

import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { ApiClientService } from './api-client.service';

/**
 * Capacitor push registration for offline message and schedule alerts.
 */
@Injectable({ providedIn: 'root' })
export class PushRegistrationService {
  constructor(private readonly api: ApiClientService) {}

  /**
   * Requests permission and registers the device token with the media API.
   */
  async register(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;

    await PushNotifications.register();

    await PushNotifications.addListener('registration', async (token) => {
      const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
      const deviceId = `${platform}-${token.value.slice(0, 24)}`;
      try {
        await this.api.registerDevice(deviceId, token.value, platform);
      } catch (error) {
        console.warn('device registration failed', error);
      }
    });
  }
}
