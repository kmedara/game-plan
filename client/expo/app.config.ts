/**
 * Adds the per-environment parts of the native config to `app.json`.
 *
 * EAS sets these from the build profile's environment. A local `expo start`
 * without them gets the static config, which is enough for Expo Go and the website.
 */

import type { ConfigContext, ExpoConfig } from 'expo/config';

const { androidIntentFilter, appLinkHost } = require('./scripts/app-links.js');

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const host: string | undefined = appLinkHost(process.env.EXPO_PUBLIC_API_BASE_URL);
  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();

  return {
    ...base,
    ios: {
      ...base.ios,
      ...(host === undefined ? {} : { associatedDomains: [`applinks:${host}`] }),
    },
    android: {
      ...base.android,
      ...(host === undefined ? {} : { intentFilters: [androidIntentFilter(host)] }),
      ...(mapsKey === undefined || mapsKey === ''
        ? {}
        : { config: { ...base.android?.config, googleMaps: { apiKey: mapsKey } } }),
    },
  };
};
