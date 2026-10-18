/**
 * A different signed-in user does not restore the previous account's cache.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CACHE_OWNER_KEY, CACHE_STORAGE_KEY } from './query-policy';
import { claimCacheUser, createQueryClient, noteCacheUser, openPersistedCache, preparePersistedCache } from './query-client';

describe('persisted cache owner', () => {
  beforeEach(async () => {
    noteCacheUser(undefined);
    await AsyncStorage.clear();
  });

  it('drops a saved cache that belongs to someone else', async () => {
    await AsyncStorage.setItem(CACHE_OWNER_KEY, 'user-a');
    await AsyncStorage.setItem(CACHE_STORAGE_KEY, 'user-a-cache');
    await expect(preparePersistedCache('user-b')).resolves.toBe('user-b');
    await expect(AsyncStorage.getItem(CACHE_STORAGE_KEY)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(CACHE_OWNER_KEY)).resolves.toBe('user-b');
  });

  it('keeps the saved cache for the same user', async () => {
    await AsyncStorage.setItem(CACHE_OWNER_KEY, 'user-a');
    await AsyncStorage.setItem(CACHE_STORAGE_KEY, 'user-a-cache');
    await expect(preparePersistedCache('user-a')).resolves.toBe('user-a');
    await expect(AsyncStorage.getItem(CACHE_STORAGE_KEY)).resolves.toBe('user-a-cache');
  });

  it('keeps the stored owner as the buster when nobody is signed in', async () => {
    await AsyncStorage.setItem(CACHE_OWNER_KEY, 'user-a');
    await expect(openPersistedCache(undefined)).resolves.toBe('user-a');
  });

  it('drops the in-memory cache when a different user signs in', () => {
    noteCacheUser('user-a');
    const queryClient = createQueryClient();
    queryClient.setQueryData(['teams'], ['user-a-teams']);
    expect(claimCacheUser(queryClient, 'user-a')).toBe(false);
    expect(queryClient.getQueryData(['teams'])).toEqual(['user-a-teams']);
    expect(claimCacheUser(queryClient, 'user-b')).toBe(true);
    expect(queryClient.getQueryData(['teams'])).toBeUndefined();
  });
});
