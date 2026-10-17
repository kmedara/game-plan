/**
 * The signed-in profile and its edits.
 */

import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type { UpdateProfileBody } from '@gameplan/types';
import type { ApiClient } from '../api';
import { queryKeys } from './keys';

export const meQuery = (api: Pick<ApiClient, 'getMe'>) =>
  queryOptions({ queryKey: queryKeys.me, queryFn: () => api.getMe() });

export const updateProfileMutation = (api: Pick<ApiClient, 'updateProfile'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (body: UpdateProfileBody) => api.updateProfile(body),
    onSuccess: (profile) => queryClient.setQueryData(queryKeys.me, profile),
  });
