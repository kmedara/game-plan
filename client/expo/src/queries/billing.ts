/**
 * Team plan queries. Plan status is not persisted to device storage, so a
 * stale "free" never invites a second subscription.
 */

import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { ApiClient } from '../api';
import { queryKeys } from './keys';

export const teamBillingQuery = (api: Pick<ApiClient, 'getTeamBilling'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.teamBilling(teamId), queryFn: () => api.getTeamBilling(teamId) });

/**
 * Refetches what a subscription change touches: the plan and the team summaries that carry it.
 *
 * @param queryClient - The app client.
 * @param teamId - The team whose plan changed.
 */
export const refreshBilling = (queryClient: QueryClient, teamId: string): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.teamBilling(teamId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.team(teamId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.teams, exact: true }),
  ]);
