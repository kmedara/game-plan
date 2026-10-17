/**
 * The app query client wired to the device: focus, connectivity, and persisted cache.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { AppState, Platform } from 'react-native';
import {
  CACHE_OWNER_KEY,
  CACHE_STORAGE_KEY,
  PERSIST_MAX_AGE_MS,
  isOnlineState,
  shouldPersistMutation,
  shouldPersistQuery,
} from './query-policy';

export { createQueryClient } from './query-policy';

/** Writes the dehydrated cache to AsyncStorage, which is localStorage on the website. */
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: CACHE_STORAGE_KEY,
  throttleTime: 1000,
});

/** Options for `PersistQueryClientProvider`. */
export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: {
    shouldDehydrateQuery: shouldPersistQuery,
    shouldDehydrateMutation: shouldPersistMutation,
  },
};

let bound = false;

/**
 * Connects TanStack's focus and online managers to the device once.
 *
 * On iOS and Android the app is focused while `AppState` is active, which
 * matches when the live socket is connected. The website keeps TanStack's
 * `visibilitychange` default. Connectivity comes from NetInfo on every platform.
 */
export const bindQueryManagers = (): void => {
  if (bound) return;
  bound = true;

  if (Platform.OS !== 'web') {
    focusManager.setEventListener((setFocused) => {
      const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
      return () => subscription.remove();
    });
  }

  onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(isOnlineState(state))));
};

/**
 * Keeps the persisted cache for the signed-in user only.
 *
 * When a different user signs in on the same device, the previous user's cache is
 * dropped from memory and storage before any of their screens can render.
 *
 * @param queryClient - The app client.
 * @param userId - The signed-in user.
 */
export const adoptCacheOwner = async (queryClient: QueryClient, userId: string | undefined): Promise<void> => {
  if (userId === undefined) return;
  const owner = await AsyncStorage.getItem(CACHE_OWNER_KEY).catch(() => null);
  if (owner === userId) return;
  if (owner !== null) await clearPersistedCache(queryClient);
  await AsyncStorage.setItem(CACHE_OWNER_KEY, userId).catch(() => undefined);
};

/** Drops every cached value from memory and storage, for sign-out. */
export const clearPersistedCache = async (queryClient: QueryClient): Promise<void> => {
  queryClient.clear();
  await persister.removeClient();
  await AsyncStorage.removeItem(CACHE_OWNER_KEY).catch(() => undefined);
};
