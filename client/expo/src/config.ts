/**
 * Public runtime config baked in by Expo from EXPO_PUBLIC_* variables.
 */

export type AppConfig = {
  apiBaseUrl: string;
  wsBaseUrl: string;
  authDisabled: boolean;
  googleMapsApiKey: string;
};

export const config: AppConfig = {
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/u, ''),
  wsBaseUrl: (process.env.EXPO_PUBLIC_WS_BASE_URL ?? 'ws://localhost:3000/socket').replace(/\/$/u, ''),
  authDisabled: process.env.EXPO_PUBLIC_AUTH_DISABLED === 'true',
  googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
};

/** Custom-scheme redirect identity uses after a native Hosted UI sign-in. */
export const NATIVE_AUTH_REDIRECT = 'gameplan://auth';
