/**
 * Schedule, RSVP, carpool, and lineup queries, plus the writes that update them.
 *
 * RSVP, carpool, and lineup pause while offline and resume after a relaunch.
 */

import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type {
  CarpoolClaimBody,
  CarpoolOfferBody,
  CreateEventBody,
  ExceptionEventBody,
  LineupBody,
  OccurrenceTarget,
  RsvpBody,
  ScheduleList,
  UpdateEventBody,
} from '@gameplan/types';
import type { ApiClient } from '../api';
import { PERSIST_MAX_AGE_MS } from '../query-policy';
import { mutationKeys, queryKeys } from './keys';

export const scheduleQuery = (
  api: Pick<ApiClient, 'getSchedule'>,
  teamId: string,
  from: string,
  to: string,
) =>
  queryOptions({
    queryKey: queryKeys.schedule(teamId, from, to),
    queryFn: () => api.getSchedule(teamId, from, to),
  });

export const eventQuery = (api: Pick<ApiClient, 'getEvent'>, teamId: string, eventId: string) =>
  queryOptions({
    queryKey: queryKeys.event(teamId, eventId),
    queryFn: () => api.getEvent(teamId, eventId),
  });

export const lineupQuery = (
  api: Pick<ApiClient, 'getLineup'>,
  teamId: string,
  eventId: string,
  occurrenceStartsAt: string,
) =>
  queryOptions({
    queryKey: queryKeys.lineup(teamId, eventId, occurrenceStartsAt),
    queryFn: async () =>
      (await api.getLineup(teamId, { eventId, occurrenceStartsAt })).slots,
  });

export const carpoolQuery = (
  api: Pick<ApiClient, 'getCarpool'>,
  teamId: string,
  eventId: string,
  occurrenceStartsAt: string,
) =>
  queryOptions({
    queryKey: queryKeys.carpool(teamId, eventId, occurrenceStartsAt),
    queryFn: async () =>
      (await api.getCarpool(teamId, { eventId, occurrenceStartsAt })).offers,
  });

/** Marks every loaded month for a team stale so the calendar refetches. */
export const invalidateTeamSchedule = (queryClient: QueryClient, teamId: string): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: queryKeys.teamSchedule(teamId) });

/**
 * Writes one RSVP into every cached month that contains that occurrence.
 *
 * @param current - A month's schedule, if loaded.
 * @param eventId - The occurrence's event.
 * @param occurrenceStartsAt - The occurrence start.
 * @param userId - Who answered.
 * @param status - The answer.
 */
export const applyRsvpToSchedule = (
  current: ScheduleList | undefined,
  eventId: string,
  occurrenceStartsAt: string,
  userId: string,
  status: RsvpBody['status'],
): ScheduleList | undefined => {
  if (current === undefined) return current;
  return {
    ...current,
    occurrences: current.occurrences.map((item) =>
      item.eventId === eventId && item.startsAt === occurrenceStartsAt
        ? {
            ...item,
            rsvps: [...item.rsvps.filter((rsvp) => rsvp.userId !== userId), { userId, status }],
          }
        : item,
    ),
  };
};

type RsvpVariables = { teamId: string; userId: string; body: RsvpBody };

export const rsvpMutation = (api: Pick<ApiClient, 'putRsvp'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationKey: mutationKeys.rsvp,
    networkMode: 'online' as const,
    gcTime: PERSIST_MAX_AGE_MS,
    mutationFn: ({ teamId, body }: RsvpVariables) => api.putRsvp(teamId, body),
    onMutate: async ({ teamId, userId, body }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.teamSchedule(teamId) });
      const previous = queryClient.getQueriesData<ScheduleList>({
        queryKey: queryKeys.teamSchedule(teamId),
      });
      queryClient.setQueriesData<ScheduleList>(
        { queryKey: queryKeys.teamSchedule(teamId) },
        (current) => applyRsvpToSchedule(current, body.eventId, body.occurrenceStartsAt, userId, body.status),
      );
      return { previous };
    },
    onError: (_error, { teamId }, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSuccess: (saved, { teamId }) => {
      queryClient.setQueriesData<ScheduleList>(
        { queryKey: queryKeys.teamSchedule(teamId) },
        (current) => applyRsvpToSchedule(current, saved.eventId, saved.occurrenceStartsAt, saved.userId, saved.status),
      );
    },
  });

export const carpoolOfferMutation = (api: Pick<ApiClient, 'putCarpool'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationKey: mutationKeys.carpoolOffer,
    networkMode: 'online' as const,
    gcTime: PERSIST_MAX_AGE_MS,
    mutationFn: ({ teamId, body }: { teamId: string; body: CarpoolOfferBody }) => api.putCarpool(teamId, body),
    onSuccess: (saved, { teamId }) => {
      queryClient.setQueryData(
        queryKeys.carpool(teamId, saved.eventId, saved.occurrenceStartsAt),
        saved.offers,
      );
    },
  });

export const carpoolClaimMutation = (api: Pick<ApiClient, 'claimCarpool'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationKey: mutationKeys.carpoolClaim,
    networkMode: 'online' as const,
    gcTime: PERSIST_MAX_AGE_MS,
    mutationFn: ({ teamId, body }: { teamId: string; body: CarpoolClaimBody }) => api.claimCarpool(teamId, body),
    onSuccess: (saved, { teamId }) => {
      queryClient.setQueryData(
        queryKeys.carpool(teamId, saved.eventId, saved.occurrenceStartsAt),
        saved.offers,
      );
    },
  });

export const lineupMutation = (api: Pick<ApiClient, 'putLineup'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationKey: mutationKeys.lineup,
    networkMode: 'online' as const,
    gcTime: PERSIST_MAX_AGE_MS,
    mutationFn: ({ teamId, body }: { teamId: string; body: LineupBody }) => api.putLineup(teamId, body),
    onSuccess: (saved, { teamId }) => {
      queryClient.setQueryData(
        queryKeys.lineup(teamId, saved.eventId, saved.occurrenceStartsAt),
        saved.slots,
      );
    },
  });

/** Registers mutationFn for paused writes so they can run after a relaunch. */
export const bindPersistedMutations = (queryClient: QueryClient, api: ApiClient): void => {
  queryClient.setMutationDefaults(mutationKeys.rsvp, rsvpMutation(api, queryClient));
  queryClient.setMutationDefaults(mutationKeys.carpoolOffer, carpoolOfferMutation(api, queryClient));
  queryClient.setMutationDefaults(mutationKeys.carpoolClaim, carpoolClaimMutation(api, queryClient));
  queryClient.setMutationDefaults(mutationKeys.lineup, lineupMutation(api, queryClient));
};

export const createEventMutation = (
  api: Pick<ApiClient, 'createEvent'>,
  queryClient: QueryClient,
  teamId: string,
) =>
  mutationOptions({
    mutationFn: (body: CreateEventBody) => api.createEvent(teamId, body),
    onSuccess: () => invalidateTeamSchedule(queryClient, teamId),
  });

export const updateEventMutation = (
  api: Pick<ApiClient, 'updateEvent'>,
  queryClient: QueryClient,
  teamId: string,
) =>
  mutationOptions({
    mutationFn: ({ eventId, body }: { eventId: string; body: UpdateEventBody }) =>
      api.updateEvent(teamId, eventId, body),
    onSuccess: () => invalidateTeamSchedule(queryClient, teamId),
  });

export const deleteEventMutation = (
  api: Pick<ApiClient, 'deleteEvent'>,
  queryClient: QueryClient,
  teamId: string,
) =>
  mutationOptions({
    mutationFn: (eventId: string) => api.deleteEvent(teamId, eventId),
    onSuccess: () => invalidateTeamSchedule(queryClient, teamId),
  });

export const saveOccurrenceMutation = (
  api: Pick<ApiClient, 'saveOccurrence'>,
  queryClient: QueryClient,
  teamId: string,
) =>
  mutationOptions({
    mutationFn: ({ eventId, body }: { eventId: string; body: ExceptionEventBody }) =>
      api.saveOccurrence(teamId, eventId, body),
    onSuccess: () => invalidateTeamSchedule(queryClient, teamId),
  });

export const cancelOccurrenceMutation = (
  api: Pick<ApiClient, 'cancelOccurrence'>,
  queryClient: QueryClient,
  teamId: string,
) =>
  mutationOptions({
    mutationFn: ({ eventId, body }: { eventId: string; body: OccurrenceTarget }) =>
      api.cancelOccurrence(teamId, eventId, body),
    onSuccess: () => invalidateTeamSchedule(queryClient, teamId),
  });
