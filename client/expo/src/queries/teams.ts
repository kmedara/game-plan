/**
 * Team, roster, permission, invite, and join-request queries and the writes that update them.
 *
 * Factories take the API client so screens and `state.tsx` share one definition
 * without this module importing the app context.
 */

import { infiniteQueryOptions, mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type {
  ApproveJoinRequestBody,
  CreateInviteBody,
  CreateTeamBody,
  RolePermissions,
  SendInviteBody,
  TeamInvite,
  TeamMemberProfile,
  TeamRole,
  TeamSummary,
  UpdatePositionsBody,
  UpdateTeamBody,
} from '@gameplan/types';
import type { ApiClient } from '../api';
import { queryKeys } from './keys';

/** How long fetched permissions are reused before the next screen asks again. */
export const PERMISSIONS_STALE_MS = 60_000;

/** Teams in one directory search page. */
export const DIRECTORY_PAGE = 10;

export const teamsQuery = (api: Pick<ApiClient, 'listTeams'>) =>
  queryOptions({ queryKey: queryKeys.teams, queryFn: () => api.listTeams() });

export const teamQuery = (api: Pick<ApiClient, 'getTeam'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.team(teamId), queryFn: () => api.getTeam(teamId) });

export const membersQuery = (api: Pick<ApiClient, 'listMembers'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.members(teamId), queryFn: () => api.listMembers(teamId) });

export const memberQuery = (api: Pick<ApiClient, 'getMember'>, teamId: string, userId: string) =>
  queryOptions({ queryKey: queryKeys.member(teamId, userId), queryFn: () => api.getMember(teamId, userId) });

export const permissionsQuery = (api: Pick<ApiClient, 'getPermissions'>, teamId: string) =>
  queryOptions({
    queryKey: queryKeys.permissions(teamId),
    queryFn: async () => (await api.getPermissions(teamId)).roles,
    staleTime: PERMISSIONS_STALE_MS,
  });

export const invitesQuery = (api: Pick<ApiClient, 'listInvites'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.invites(teamId), queryFn: () => api.listInvites(teamId) });

export const joinRequestsQuery = (api: Pick<ApiClient, 'listJoinRequests'>, teamId: string) =>
  queryOptions({ queryKey: queryKeys.joinRequests(teamId), queryFn: () => api.listJoinRequests(teamId) });

/** An invite code preview. A bad code fails at once instead of retrying. */
export const invitePreviewQuery = (api: Pick<ApiClient, 'getInvite'>, code: string) =>
  queryOptions({ queryKey: queryKeys.invite(code), queryFn: () => api.getInvite(code), retry: false });

/** Directory search pages for one query string. */
export const directoryQuery = (api: Pick<ApiClient, 'searchTeams'>, query: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.directory(query),
    queryFn: ({ pageParam }) =>
      api.searchTeams(query, { limit: DIRECTORY_PAGE, ...(pageParam !== undefined ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor,
    staleTime: 0,
  });

/**
 * Replaces one team in the list and its own entry, so every screen shows a saved change.
 *
 * @param queryClient - The app client.
 * @param team - The team the API returned.
 */
export const rememberTeam = (queryClient: QueryClient, team: TeamSummary): void => {
  queryClient.setQueryData(queryKeys.teams, (current: TeamSummary[] | undefined) =>
    current?.map((item) => (item.teamId === team.teamId ? team : item)),
  );
  queryClient.setQueryData(queryKeys.team(team.teamId), team);
};

/**
 * Replaces the cached permission rows after a save.
 *
 * @param queryClient - The app client.
 * @param teamId - The team that was saved.
 * @param rows - The rows the API returned.
 */
export const rememberTeamPermissions = (queryClient: QueryClient, teamId: string, rows: RolePermissions[]): void => {
  queryClient.setQueryData(queryKeys.permissions(teamId), rows);
};

export const createTeamMutation = (api: Pick<ApiClient, 'createTeam'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (body: CreateTeamBody) => api.createTeam(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.teams }),
  });

export const updateTeamMutation = (api: Pick<ApiClient, 'updateTeam'>, queryClient: QueryClient, teamId: string) =>
  mutationOptions({
    mutationFn: (body: UpdateTeamBody) => api.updateTeam(teamId, body),
    onSuccess: (team) => rememberTeam(queryClient, team),
  });

export const setPositionsMutation = (api: Pick<ApiClient, 'setPositions'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, positions }: { teamId: string; positions: UpdatePositionsBody['positions'] }) =>
      api.setPositions(teamId, positions),
    onSuccess: (team) => rememberTeam(queryClient, team),
  });

export const acceptInviteMutation = (api: Pick<ApiClient, 'acceptInvite'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: (code: string) => api.acceptInvite(code),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.teams }),
  });

export const requestJoinMutation = (api: Pick<ApiClient, 'requestJoin'>) =>
  mutationOptions({ mutationFn: (teamId: string) => api.requestJoin(teamId) });

export const approveJoinRequestMutation = (
  api: Pick<ApiClient, 'approveJoinRequest'>,
  queryClient: QueryClient,
  teamId: string,
) =>
  mutationOptions({
    mutationFn: ({ requestId, role }: { requestId: string; role: ApproveJoinRequestBody['role'] }) =>
      api.approveJoinRequest(teamId, requestId, role),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests(teamId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.members(teamId) }),
      ]),
  });

export const rejectJoinRequestMutation = (
  api: Pick<ApiClient, 'rejectJoinRequest'>,
  queryClient: QueryClient,
  teamId: string,
) =>
  mutationOptions({
    mutationFn: (requestId: string) => api.rejectJoinRequest(teamId, requestId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests(teamId) }),
  });

export const createInviteMutation = (api: Pick<ApiClient, 'createInvite'>, queryClient: QueryClient, teamId: string) =>
  mutationOptions({
    mutationFn: (role: CreateInviteBody['role']) => api.createInvite(teamId, role),
    onSuccess: (invite) =>
      queryClient.setQueryData(queryKeys.invites(teamId), (current: TeamInvite[] | undefined) => [
        invite,
        ...(current ?? []).filter((item) => item.role !== invite.role),
      ]),
  });

/** Sends an invite from GamePlan. Sending creates the role's code when it has none. */
export const sendInviteMutation = (api: Pick<ApiClient, 'sendInvite'>, queryClient: QueryClient, teamId: string) =>
  mutationOptions({
    mutationFn: (body: SendInviteBody) => api.sendInvite(teamId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invites(teamId) }),
  });

export const deleteInviteMutation =(api: Pick<ApiClient, 'deleteInvite'>, queryClient: QueryClient, teamId: string) =>
  mutationOptions({
    mutationFn: (role: TeamRole) => api.deleteInvite(teamId, role),
    onSuccess: (_result, role) =>
      queryClient.setQueryData(queryKeys.invites(teamId), (current: TeamInvite[] | undefined) =>
        current?.filter((invite) => invite.role !== role),
      ),
  });

export const assignMemberRolesMutation = (
  api: Pick<ApiClient, 'assignMemberRoles'>,
  queryClient: QueryClient,
  teamId: string,
  userId: string,
) =>
  mutationOptions({
    mutationFn: (roles: readonly TeamRole[]) => api.assignMemberRoles(teamId, userId, roles),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.member(teamId, userId), (current: TeamMemberProfile | undefined) =>
        current === undefined ? saved : { ...current, ...saved },
      );
      return queryClient.invalidateQueries({ queryKey: queryKeys.members(teamId) });
    },
  });

export const putPermissionsMutation = (
  api: Pick<ApiClient, 'putPermissions'>,
  queryClient: QueryClient,
  teamId: string,
) =>
  mutationOptions({
    mutationFn: (roles: RolePermissions[]) => api.putPermissions(teamId, roles),
    onSuccess: (saved) => rememberTeamPermissions(queryClient, teamId, saved.roles),
  });
