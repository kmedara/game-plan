/**
 * Team album pages. Not written to device storage: the items point at files
 * whose download links expire, and a removed photo should not linger offline.
 */

import { infiniteQueryOptions } from '@tanstack/react-query';
import type { ApiClient } from '../api';
import { queryKeys } from './keys';

export const albumQuery = (api: Pick<ApiClient, 'listAlbum'>, teamId: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.album(teamId),
    queryFn: ({ pageParam }) => api.listAlbum(teamId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor,
  });
