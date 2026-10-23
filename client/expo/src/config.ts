/**
 * Public runtime config baked in by Expo from EXPO_PUBLIC_* variables.
 */

export type AppConfig = {
  apiBaseUrl: string;
  wsBaseUrl: string;
  authDisabled: boolean;
  googleMapsApiKey: string;
  vapidPublicKey: string;
  easProjectId: string;
  /** Whether the iOS app may link to web checkout. Apple allows it only in some storefronts. */
  iosWebUpgrade: boolean;
  /** Where people send privacy and support requests. The privacy page omits the line when blank. */
  supportEmail: string;
};

export const config: AppConfig = {
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4200/api').replace(/\/$/u, ''),
  wsBaseUrl: (process.env.EXPO_PUBLIC_WS_BASE_URL ?? 'ws://localhost:3000/socket').replace(/\/$/u, ''),
  authDisabled: process.env.EXPO_PUBLIC_AUTH_DISABLED === 'true',
  googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  vapidPublicKey: process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '',
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
  iosWebUpgrade: process.env.EXPO_PUBLIC_IOS_WEB_UPGRADE === 'true',
  supportEmail: (process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '').trim(),
};

/** Custom-scheme redirect identity uses after a native Hosted UI sign-in. */
export const NATIVE_AUTH_REDIRECT = 'gameplan://auth';
