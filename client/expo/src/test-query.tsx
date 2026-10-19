/**
 * Query client and provider for tests. Imported by test files only.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const clients = new Set<QueryClient>();

/** A client that never retries and never persists, so tests settle in one pass. */
export const createTestQueryClient = (): QueryClient => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      // A finite gcTime leaves a 5-minute cleanup timer after each mutation, which keeps Jest from exiting.
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.add(client);
  return client;
};

/**
 * Clears every client made by `createTestQueryClient`.
 *
 * Query options with their own `gcTime` start cleanup timers when a test unmounts; clearing cancels them.
 */
export const clearTestQueryClients = (): void => {
  for (const client of clients) client.clear();
  clients.clear();
};

/** A `wrapper` for `renderHook` and `render` that provides `client`. */
export const queryWrapper = (client: QueryClient) =>
  function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
