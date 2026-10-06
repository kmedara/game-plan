/**
 * Capacitor bridges for native map API key (Android) and MapKit picker (iOS).
 */

import { registerPlugin } from '@capacitor/core';

/** Reads the Android-restricted Maps SDK key from the app manifest. */
export type MapsKeyPlugin = {
  getAndroidMapsApiKey(): Promise<{ apiKey: string }>;
};

/** MapKit modal picker that returns a chosen coordinate. */
export type MapPickerPlugin = {
  pickOnMap(options?: {
    latitude?: number;
    longitude?: number;
  }): Promise<{ latitude: number; longitude: number }>;
};

export const MapsKey = registerPlugin<MapsKeyPlugin>('MapsKey');

export const MapPicker = registerPlugin<MapPickerPlugin>('MapPicker');
