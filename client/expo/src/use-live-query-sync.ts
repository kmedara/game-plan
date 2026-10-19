/**
 * Subscribes the query cache to the live socket for the signed-in shell.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyLiveEvent, resyncAfterReconnect } from './queries/live';
import { useApp } from './state';

/** Turns each fanout event into a cache write or refetch, and catches up after a reconnect. */
export const useLiveQuerySync = (): void => {
  const { live } = useApp();
  const queryClient = useQueryClient();
  useEffect(() => live.subscribe((event) => applyLiveEvent(queryClient, event)), [live, queryClient]);
  useEffect(() => live.onReconnect(() => resyncAfterReconnect(queryClient)), [live, queryClient]);
};
