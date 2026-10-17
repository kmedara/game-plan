/**
 * Cache rules shared by the app and tests: retries, staleness, persistence, and online state.
 *
 * This file has no native imports so the rules can be unit tested. `query-client.ts`
 * wires them to AsyncStorage, NetInfo, and AppState.
 */

import { QueryClient, type Query } from '@tanstack/react-query';
import { PERSISTED_MUTATION_KINDS, PERSISTED_QUERY_KINDS } from './queries/keys';

/** Default time a loaded value is reused before a mounting screen asks again. */
export const DEFAULT_STALE_MS = 30_000;

/** How long persisted values stay usable. Cache entries are kept at least this long. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Device storage key for the dehydrated cache. */
export const CACHE_STORAGE_KEY = 'gameplan-query-cache';

/** Device storage key for the user id the persisted cache belongs to. */
export const CACHE_OWNER_KEY = 'gameplan-cache-owner';

/**
 * Whether a failed request might succeed on retry.
 *
 * Network failures surface as `TypeError`, and the API client throws `http_5xx`
 * codes for server errors. Anything else, such as `forbidden` or `http_404`,
 * will fail the same way again.
 */
export const isTransientError = (error: unknown): boolean => {
  if (error instanceof TypeError) return true;
  return error instanceof Error && /^http_5\d\d$/.test(error.message);
};

/** Retries transient failures up to twice; every other failure surfaces at once. */
export const retryTransient = (failureCount: number, error: unknown): boolean =>
  failureCount < 2 && isTransientError(error);

/** Only settled values of persisted kinds are written to storage. */
export const shouldPersistQuery = (query: Pick<Query, 'queryKey' | 'state'>): boolean => {
  const kind = query.queryKey[0];
  return query.state.status === 'success' && typeof kind === 'string' && PERSISTED_QUERY_KINDS.has(kind);
};

/**
 * Only paused writes of persisted kinds are written to storage.
 *
 * Chat sends and other one-shot writes stay in memory for the visit, so they are
 * not replayed after a relaunch.
 */
export const shouldPersistMutation = (mutation: {
  options: { mutationKey?: readonly unknown[] };
  state: { isPaused: boolean };
}): boolean => {
  if (!mutation.state.isPaused) return false;
  const kind = mutation.options.mutationKey?.[0];
  return typeof kind === 'string' && PERSISTED_MUTATION_KINDS.has(kind);
};

/**
 * Online state from a NetInfo snapshot.
 *
 * Both flags start as `null` before the first check, which counts as online so the
 * app never flashes an offline state at launch. Only a definite `false` pauses requests.
 */
export const isOnlineState = (state: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}): boolean => state.isConnected !== false && state.isInternetReachable !== false;

/** A client with the app defaults. The provider and tests both build clients here. */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_MS,
        gcTime: PERSIST_MAX_AGE_MS,
        retry: retryTransient,
      },
      mutations: {
        retry: false,
        networkMode: 'always',
      },
    },
  });
