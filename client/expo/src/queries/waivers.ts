/**
 * Waiver queries and the writes that update them.
 *
 * Nothing here is persisted to device storage: whether something is signed
 * must come from the server, so a stale "missing" never asks for a second signature.
 */

import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type {
  CreateWaiverBody,
  CreateWaiverFromTemplateBody,
  CreateWaiverTemplateBody,
  SignWaiverBody,
  UpdateWaiverBody,
  UpdateWaiverTemplateBody,
} from '@gameplan/types';
import type { ApiClient } from '../api';
import { queryKeys } from './keys';

export const myWaiversQuery = (api: Pick<ApiClient, 'listMyWaivers'>) =>
  queryOptions({ queryKey: queryKeys.myWaivers, queryFn: () => api.listMyWaivers() });

export const waiversQuery = (api: Pick<ApiClient, 'listWaivers'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.waivers(teamId), queryFn: () => api.listWaivers(teamId) });

export const waiverQuery = (api: Pick<ApiClient, 'getWaiver'>, teamId: string, waiverId: string) =>
  queryOptions({ queryKey: queryKeys.waiver(teamId, waiverId), queryFn: () => api.getWaiver(teamId, waiverId) });

export const waiverSignatureQuery = (
  api: Pick<ApiClient, 'getWaiverSignature'>,
  teamId: string,
  waiverId: string,
  memberId: string,
) =>
  queryOptions({
    queryKey: queryKeys.waiverSignature(teamId, waiverId, memberId),
    queryFn: () => api.getWaiverSignature(teamId, waiverId, memberId),
  });

export const teamWaiverTemplatesQuery = (api: Pick<ApiClient, 'listTeamWaiverTemplates'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.teamWaiverTemplates(teamId), queryFn: () => api.listTeamWaiverTemplates(teamId) });

export const orgWaiverTemplatesQuery = (api: Pick<ApiClient, 'listOrgWaiverTemplates'>, orgId: string) =>
  queryOptions({ queryKey: queryKeys.orgWaiverTemplates(orgId), queryFn: () => api.listOrgWaiverTemplates(orgId) });

/**
 * Refetches everything a waiver write can change: the team's waivers and the
 * caller's own list.
 *
 * @param queryClient - The app client.
 * @param teamId - The team, when known.
 */
export const refreshWaivers = (queryClient: QueryClient, teamId?: string): Promise<unknown> =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.myWaivers }),
    ...(teamId === undefined
      ? []
      : [
          queryClient.invalidateQueries({ queryKey: queryKeys.waivers(teamId) }),
          queryClient.invalidateQueries({ queryKey: ['waiver', teamId] }),
          queryClient.invalidateQueries({ queryKey: ['waiverSignature', teamId] }),
        ]),
  ]);

export const createWaiverMutation = (api: Pick<ApiClient, 'createWaiver'>, queryClient: QueryClient, teamId: string) =>
  mutationOptions({
    mutationFn: (body: CreateWaiverBody) => api.createWaiver(teamId, body),
    onSuccess: () => refreshWaivers(queryClient, teamId),
  });

export const createWaiverFromTemplateMutation = (
  api: Pick<ApiClient, 'createWaiverFromTemplate'>,
  queryClient: QueryClient,
  teamId: string,
) =>
  mutationOptions({
    mutationFn: (body: CreateWaiverFromTemplateBody) => api.createWaiverFromTemplate(teamId, body),
    onSuccess: () => refreshWaivers(queryClient, teamId),
  });

export const updateWaiverMutation = (
  api: Pick<ApiClient, 'updateWaiver'>,
  queryClient: QueryClient,
  teamId: string,
  waiverId: string,
) =>
  mutationOptions({
    mutationFn: (body: UpdateWaiverBody) => api.updateWaiver(teamId, waiverId, body),
    onSuccess: () => refreshWaivers(queryClient, teamId),
  });

export const signWaiverMutation = (api: Pick<ApiClient, 'signWaiver'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, waiverId, memberId, body }: { teamId: string; waiverId: string; memberId: string; body: SignWaiverBody }) =>
      api.signWaiver(teamId, waiverId, memberId, body),
    onSettled: (_data, _error, { teamId }) => refreshWaivers(queryClient, teamId),
  });

export const paperWaiverMutation = (
  api: Pick<ApiClient, 'recordPaperWaiver' | 'removePaperWaiver'>,
  queryClient: QueryClient,
  teamId: string,
  waiverId: string,
) =>
  mutationOptions({
    mutationFn: async ({ memberId, signerName }: { memberId: string; signerName?: string }) => {
      if (signerName === undefined) await api.removePaperWaiver(teamId, waiverId, memberId);
      else await api.recordPaperWaiver(teamId, waiverId, memberId, signerName);
    },
    onSuccess: () => refreshWaivers(queryClient, teamId),
  });

export const createOrgWaiverTemplateMutation = (
  api: Pick<ApiClient, 'createOrgWaiverTemplate'>,
  queryClient: QueryClient,
  orgId: string,
) =>
  mutationOptions({
    mutationFn: (body: CreateWaiverTemplateBody) => api.createOrgWaiverTemplate(orgId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.orgWaiverTemplates(orgId) }),
  });

export const updateOrgWaiverTemplateMutation = (
  api: Pick<ApiClient, 'updateOrgWaiverTemplate'>,
  queryClient: QueryClient,
  orgId: string,
) =>
  mutationOptions({
    mutationFn: ({ templateId, body }: { templateId: string; body: UpdateWaiverTemplateBody }) =>
      api.updateOrgWaiverTemplate(orgId, templateId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.orgWaiverTemplates(orgId) }),
  });

export const deleteOrgWaiverTemplateMutation = (
  api: Pick<ApiClient, 'deleteOrgWaiverTemplate'>,
  queryClient: QueryClient,
  orgId: string,
) =>
  mutationOptions({
    mutationFn: (templateId: string) => api.deleteOrgWaiverTemplate(orgId, templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.orgWaiverTemplates(orgId) }),
  });
