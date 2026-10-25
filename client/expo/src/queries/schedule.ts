/**
 * Schedule, RSVP, carpool, and lineup queries, plus the writes that update them.
 *
 * RSVP, carpool, and lineup pause while offline and resume after a relaunch.
 */

import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type {
  AcceptFixtureBody,
  CarpoolClaimBody,
  ClaimSignupBody,
  PutSignupsBody,
  CarpoolOfferBody,
  CreateEventBody,
  ExceptionEventBody,
  LineupBody,
  OccurrenceTarget,
  ProposeFixtureBody,
  RsvpBody,
  ScheduleList,
  UpdateEventBody,
  UpdateFixtureBody,
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

export const fixturesQuery = (api: Pick<ApiClient, 'listFixtures'>, teamId: string) =>
  queryOptions({
    queryKey: queryKeys.fixtures(teamId),
    queryFn: () => api.listFixtures(teamId),
  });

/** Marks fixture lists stale for every club a shared game touches. */
export const invalidateFixtures = (queryClient: QueryClient, teamIds: readonly string[]): Promise<void> =>
  Promise.all(teamIds.map((teamId) => queryClient.invalidateQueries({ queryKey: queryKeys.fixtures(teamId) }))).then(
    () => undefined,
  );

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
    // The version comes along so a save can say which lineup it replaces.
    queryFn: () => api.getLineup(teamId, { eventId, occurrenceStartsAt }),
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

export const signupsQuery = (
  api: Pick<ApiClient, 'getSignups'>,
  teamId: string,
  eventId: string,
  occurrenceStartsAt: string,
) =>
  queryOptions({
    queryKey: queryKeys.signups(teamId, eventId, occurrenceStartsAt),
    queryFn: async () => (await api.getSignups(teamId, eventId, occurrenceStartsAt)).slots,
  });

/**
 * Stores a sign-up response in the cache.
 *
 * Claims are not queued offline like carpool seats: a claim replayed hours
 * later could take a place someone else already has.
 *
 * @param queryClient - The app client.
 * @param teamId - The team.
 * @param saved - The response.
 */
const rememberSignups = (
  queryClient: QueryClient,
  teamId: string,
  saved: { eventId: string; occurrenceStartsAt: string; slots: unknown },
): void => {
  queryClient.setQueryData(queryKeys.signups(teamId, saved.eventId, saved.occurrenceStartsAt), saved.slots);
};

export const putSignupsMutation = (api: Pick<ApiClient, 'putSignups'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, body }: { teamId: string; body: PutSignupsBody }) => api.putSignups(teamId, body),
    onSuccess: (saved, { teamId }) => rememberSignups(queryClient, teamId, saved),
  });

export const claimSignupMutation = (api: Pick<ApiClient, 'claimSignup'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, body }: { teamId: string; body: ClaimSignupBody }) => api.claimSignup(teamId, body),
    onSuccess: (saved, { teamId }) => rememberSignups(queryClient, teamId, saved),
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
      queryClient.setQueryData(queryKeys.lineup(teamId, saved.eventId, saved.occurrenceStartsAt), saved);
    },
  });

/** Registers mutationFn for paused writes so they can run after a relaunch. */
export const bindPersistedMutations = (queryClient: QueryClient, api: ApiClient): void => {
  queryClient.setMutationDefaults(mutationKeys.rsvp, rsvpMutation(api, queryClient));
  queryClient.setMutationDefaults(mutationKeys.carpoolOffer, carpoolOfferMutation(api, queryClient));
  queryClient.setMutationDefaults(mutationKeys.carpoolClaim, carpoolClaimMutation(api, queryClient));
  queryClient.setMutationDefaults(mutationKeys.lineup, lineupMutation(api, queryClient));
};

export const proposeFixtureMutation = (api: Pick<ApiClient, 'proposeFixture'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, eventId, body }: { teamId: string; eventId: string; body: ProposeFixtureBody }) =>
      api.proposeFixture(teamId, eventId, body),
    onSuccess: (saved) => invalidateFixtures(queryClient, [saved.proposerTeamId, saved.inviteeTeamId]),
  });

export const acceptFixtureMutation = (api: Pick<ApiClient, 'acceptFixture'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ fixtureId, body }: { fixtureId: string; body: AcceptFixtureBody }) =>
      api.acceptFixture(fixtureId, body),
    onSuccess: async (saved) => {
      await invalidateFixtures(queryClient, [saved.proposerTeamId, saved.inviteeTeamId]);
      await invalidateTeamSchedule(queryClient, saved.inviteeTeamId);
      await invalidateTeamSchedule(queryClient, saved.proposerTeamId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });

export const declineFixtureMutation = (
  api: Pick<ApiClient, 'declineFixture'>,
  queryClient: QueryClient,
) =>
  mutationOptions({
    mutationFn: ({ fixtureId, teamIds }: { fixtureId: string; teamIds: string[] }) => api.declineFixture(fixtureId),
    onSuccess: async (_saved, { teamIds }) => {
      await invalidateFixtures(queryClient, teamIds);
      await Promise.all(teamIds.map((teamId) => invalidateTeamSchedule(queryClient, teamId)));
    },
  });

export const updateFixtureMutation = (api: Pick<ApiClient, 'updateFixture'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ fixtureId, body }: { fixtureId: string; body: UpdateFixtureBody }) =>
      api.updateFixture(fixtureId, body),
    onSuccess: async (saved) => {
      const teamIds = [saved.proposerTeamId, saved.inviteeTeamId, saved.homeTeamId, saved.awayTeamId].filter(
        (teamId): teamId is string => teamId !== undefined,
      );
      await invalidateFixtures(queryClient, teamIds);
      await Promise.all(teamIds.map((teamId) => invalidateTeamSchedule(queryClient, teamId)));
    },
  });

export const unlinkFixtureMutation = (api: Pick<ApiClient, 'unlinkFixture'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ fixtureId, teamIds }: { fixtureId: string; teamIds: string[] }) => api.unlinkFixture(fixtureId),
    onSuccess: async (_saved, { teamIds }) => {
      await invalidateFixtures(queryClient, teamIds);
      await Promise.all(teamIds.map((teamId) => invalidateTeamSchedule(queryClient, teamId)));
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });

export const createEventMutation = (api: Pick<ApiClient, 'createEvent'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, body }: { teamId: string; body: CreateEventBody }) => api.createEvent(teamId, body),
    onSuccess: (_saved, { teamId }) => invalidateTeamSchedule(queryClient, teamId),
  });

export const updateEventMutation = (api: Pick<ApiClient, 'updateEvent'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, eventId, body }: { teamId: string; eventId: string; body: UpdateEventBody }) =>
      api.updateEvent(teamId, eventId, body),
    onSuccess: (_saved, { teamId }) => invalidateTeamSchedule(queryClient, teamId),
  });

export const deleteEventMutation = (api: Pick<ApiClient, 'deleteEvent'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, eventId }: { teamId: string; eventId: string }) => api.deleteEvent(teamId, eventId),
    onSuccess: (_saved, { teamId }) => invalidateTeamSchedule(queryClient, teamId),
  });

export const saveOccurrenceMutation = (api: Pick<ApiClient, 'saveOccurrence'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, eventId, body }: { teamId: string; eventId: string; body: ExceptionEventBody }) =>
      api.saveOccurrence(teamId, eventId, body),
    onSuccess: (_saved, { teamId }) => invalidateTeamSchedule(queryClient, teamId),
  });

export const cancelOccurrenceMutation = (api: Pick<ApiClient, 'cancelOccurrence'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ teamId, eventId, body }: { teamId: string; eventId: string; body: OccurrenceTarget }) =>
      api.cancelOccurrence(teamId, eventId, body),
    onSuccess: (_saved, { teamId }) => invalidateTeamSchedule(queryClient, teamId),
  });
