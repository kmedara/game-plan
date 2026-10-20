/**
 * Organization queries. Not persisted to device storage, like plan status.
 */

import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { ApiClient } from '../api';
import { queryKeys } from './keys';

export const orgsQuery = (api: Pick<ApiClient, 'listOrgs'>) =>
  queryOptions({ queryKey: queryKeys.orgs, queryFn: () => api.listOrgs() });

export const orgQuery = (api: Pick<ApiClient, 'getOrg'>, orgId: string) =>
  queryOptions({ queryKey: queryKeys.org(orgId), queryFn: () => api.getOrg(orgId) });

export const teamOrgQuery = (api: Pick<ApiClient, 'getTeamOrg'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.teamOrg(teamId), queryFn: () => api.getTeamOrg(teamId) });

/**
 * Refetches what an organization change touches: its detail, the list, and
 * member teams' plans (which come from the organization).
 *
 * @param queryClient - The app client.
 * @param orgId - The organization.
 */
export const refreshOrg = (queryClient: QueryClient, orgId: string): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.org(orgId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.orgs }),
    queryClient.invalidateQueries({ queryKey: queryKeys.teams }),
  ]);
