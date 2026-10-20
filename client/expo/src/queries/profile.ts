/**
 * The signed-in profile and its edits.
 */

import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type { UpdatePreferencesBody, UpdateProfileBody } from '@gameplan/types';
import type { ApiClient } from '../api';
import { queryKeys } from './keys';

export const meQuery = (api: Pick<ApiClient, 'getMe'>) =>
  queryOptions({ queryKey: queryKeys.me, queryFn: () => api.getMe() });

export const updateProfileMutation = (api: Pick<ApiClient, 'updateProfile'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (body: UpdateProfileBody) => api.updateProfile(body),
    onSuccess: (profile) => queryClient.setQueryData(queryKeys.me, profile),
  });

export const preferencesQuery = (api: Pick<ApiClient, 'getPreferences'>) =>
  queryOptions({ queryKey: queryKeys.preferences, queryFn: () => api.getPreferences() });

export const updatePreferencesMutation = (api: Pick<ApiClient, 'updatePreferences'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (body: UpdatePreferencesBody) => api.updatePreferences(body),
    onSuccess: (preferences) => queryClient.setQueryData(queryKeys.preferences, preferences),
  });
