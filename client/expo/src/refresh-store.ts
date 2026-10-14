/**
 * Native refresh-token store backed by Expo SecureStore.
 */

import * as SecureStore from 'expo-secure-store';
import type { RefreshStore } from '@gameplan/client-session';

/** SecureStore key for the native refresh token. */
export const EXPO_REFRESH_KEY = 'ts_refresh';

/** Selected-team preference key. */
export const SELECTED_TEAM_KEY = 'selected-team-id';

/**
 * Refresh store for iOS and Android. The website uses {@link WebRefreshStore}.
 */
export class ExpoRefreshStore implements RefreshStore {
  async get(): Promise<string | null> {
    return SecureStore.getItemAsync(EXPO_REFRESH_KEY);
  }

  async set(token: string): Promise<void> {
    await SecureStore.setItemAsync(EXPO_REFRESH_KEY, token);
  }

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(EXPO_REFRESH_KEY);
  }
}

/** Reads a persisted string, using localStorage on web and SecureStore on device. */
export const readPreference = async (key: string, native: boolean): Promise<string | undefined> => {
  try {
    if (!native) {
      if (typeof localStorage === 'undefined') return undefined;
      const value = localStorage.getItem(key);
      return value !== null && value.length > 0 ? value : undefined;
    }
    const value = await SecureStore.getItemAsync(key);
    return value !== null && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
};

/** Writes or clears a persisted string. */
export const writePreference = async (
  key: string,
  value: string | undefined,
  native: boolean,
): Promise<void> => {
  try {
    if (!native) {
      if (typeof localStorage === 'undefined') return;
      if (value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return;
    }
    if (value === undefined) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // The in-memory value still applies for this visit.
  }
};
