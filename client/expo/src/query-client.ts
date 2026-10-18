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

/** User id the in-memory cache was restored or claimed for. */
let cacheRestoredFor: string | undefined;

/** Records which user the next restore belongs to, before the persister hydrates. */
export const noteCacheUser = (userId: string | undefined): void => {
  cacheRestoredFor = userId;
};

/**
 * Drops a saved cache that belongs to someone else, then returns the persist buster.
 *
 * The buster is the user id. A restored client with a different buster is discarded
 * and never hydrated, so the previous account cannot paint after a reload.
 *
 * @param userId - The signed-in user.
 * @returns The buster to give `PersistQueryClientProvider`.
 */
export const preparePersistedCache = async (userId: string): Promise<string> => {
  const owner = await AsyncStorage.getItem(CACHE_OWNER_KEY).catch(() => null);
  if (owner !== userId) {
    await persister.removeClient();
    await AsyncStorage.setItem(CACHE_OWNER_KEY, userId).catch(() => undefined);
  }
  return userId;
};

/**
 * Chooses the buster before the persister restores.
 *
 * A signed-in user replaces a foreign cache first. A signed-out launch keeps the
 * stored owner's buster so a failed refresh does not throw away the offline cache,
 * and a later sign-in as someone else still misses that marker and clears it.
 *
 * @param userId - The signed-in user, when the session restored.
 * @returns The buster for this launch.
 */
export const openPersistedCache = async (userId: string | undefined): Promise<string> => {
  if (userId !== undefined) {
    const buster = await preparePersistedCache(userId);
    noteCacheUser(userId);
    return buster;
  }
  const owner = await AsyncStorage.getItem(CACHE_OWNER_KEY).catch(() => null);
  noteCacheUser(owner ?? undefined);
  return owner ?? 'signed-out';
};

/**
 * Whether the signed-in user is not the one the in-memory cache was restored for.
 *
 * @param userId - The signed-in user.
 * @returns True when the shell must wait for {@link claimCacheUser}.
 */
export const cacheUserMismatch = (userId: string | undefined): boolean =>
  userId !== undefined && cacheRestoredFor !== userId;

/**
 * Drops the in-memory cache when the signed-in user is not the one it was restored for.
 *
 * @param queryClient - The app client.
 * @param userId - The signed-in user.
 * @returns Whether the previous user's cache was cleared.
 */
export const claimCacheUser = (queryClient: QueryClient, userId: string | undefined): boolean => {
  if (userId === undefined || cacheRestoredFor === userId) return false;
  cacheRestoredFor = userId;
  queryClient.clear();
  void preparePersistedCache(userId);
  return true;
};

/**
 * Keeps the persisted cache for the signed-in user only.
 *
 * @param queryClient - The app client.
 * @param userId - The signed-in user.
 */
export const adoptCacheOwner = async (queryClient: QueryClient, userId: string | undefined): Promise<void> => {
  if (userId === undefined || cacheRestoredFor === userId) return;
  cacheRestoredFor = userId;
  queryClient.clear();
  await preparePersistedCache(userId);
};

/** Drops every cached value from memory and storage, for sign-out. */
export const clearPersistedCache = async (queryClient: QueryClient): Promise<void> => {
  queryClient.clear();
  cacheRestoredFor = undefined;
  await persister.removeClient();
  await AsyncStorage.removeItem(CACHE_OWNER_KEY).catch(() => undefined);
};
