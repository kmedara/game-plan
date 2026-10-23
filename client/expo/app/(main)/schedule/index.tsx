/**
 * Month calendar and the day list. Sheets open the
 * event, add, and edit views.
 */

import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useCalendars } from 'expo-localization';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { deviceTimeZone, eventTypesOnDay, mergeSchedules, type TeamOccurrence } from '@/src/athlete-schedule';
import { type EventResponse, type ScheduleList, type UpdateEventBody } from '@gameplan/types';
import { IncomingFixtures } from '@/src/fixture-panel';
import { queryError } from '@/src/errors';
import { appLocale } from '@/src/i18n';
import type { MapsProvider } from '@/src/maps';
import {
  buildMonthGrid,
  dayKeyInZone,
  dayTitle,
  monthTitle,
  shiftCalendarMonth,
  wallTimeToIso,
  weekdayLabelsForLocale,
  type CalendarMonth,
} from '@/src/schedule-calendar';
import { Sheet } from '@/src/sheet';
import { RefreshableScroll } from '@/src/pull-refresh';
import {
  cancelOccurrenceMutation,
  createEventMutation,
  deleteEventMutation,
  eventQuery,
  fixturesQuery,
  rsvpMutation,
  saveOccurrenceMutation,
  scheduleQuery,
  updateEventMutation,
  updateFixtureMutation,
} from '@/src/queries/schedule';
import { useApp, useBrandTeam } from '@/src/state';
import { useTeamsWithPermission } from '@/src/team-access';
import { colors, EVENT_TYPE_COLORS } from '@/src/theme';
import { Button, ErrorText } from '@/src/ui';
import { AddEvent } from '@/src/schedule/add-event';
import { EventDetail } from '@/src/schedule/event-detail';
import { EventRow } from '@/src/schedule/event-row';
import { ScopeChoice } from '@/src/schedule/scope-choice';

const monthRange = (month: CalendarMonth, timeZone: string): { from: string; to: string } => {
  const cells = buildMonthGrid(month.year, month.month, timeZone);
  const first = cells[0]?.key ?? `${month.year}-01-01`;
  const last = cells.at(-1)?.key ?? first;
  return { from: wallTimeToIso(timeZone, first, '00:00'), to: wallTimeToIso(timeZone, last, '23:59') };
};


export default function ScheduleScreen() {
  const { t } = useTranslation();
  const { api, brand, teams } = useApp();
  const queryClient = useQueryClient();
  const zone = deviceTimeZone(useCalendars()[0]?.timeZone);
  const [month, setMonth] = useState<CalendarMonth>(() => {
    const key = dayKeyInZone(new Date(), zone);
    const [year, monthNumber] = key.split('-').map(Number) as [number, number];
    return { year, month: monthNumber };
  });
  const [selected, setSelected] = useState(() => dayKeyInZone(new Date(), zone));
  const range = monthRange(month, zone);
  const scheduleQueries = useQueries({
    queries: teams.map((team) => ({
      ...scheduleQuery(api, team.teamId, range.from, range.to),
      placeholderData: (
        previous: ScheduleList | undefined,
        previousQuery: { queryKey: readonly unknown[] } | undefined,
      ) => (previousQuery?.queryKey[1] === team.teamId ? previous : undefined),
    })),
  });
  const fixtureQueries = useQueries({
    queries: teams.map((team) => fixturesQuery(api, team.teamId)),
  });
  const fixtures = fixtureQueries.flatMap((query) => query.data?.fixtures ?? []);
  const events = mergeSchedules(
    scheduleQueries.flatMap((query, index) => {
      const team = teams[index];
      if (team === undefined || query.data === undefined) return [];
      return [{ teamId: team.teamId, occurrences: query.data.occurrences }];
    }),
  );
  const createEvent = useMutation(createEventMutation(api, queryClient));
  const updateEvent = useMutation(updateEventMutation(api, queryClient));
  const updateFixture = useMutation(updateFixtureMutation(api, queryClient));
  const deleteEvent = useMutation(deleteEventMutation(api, queryClient));
  const saveOccurrence = useMutation(saveOccurrenceMutation(api, queryClient));
  const cancelOccurrence = useMutation(cancelOccurrenceMutation(api, queryClient));
  const putRsvp = useMutation(rsvpMutation(api, queryClient));
  const manageable = useTeamsWithPermission('manage_events', teams.length > 0);
  const [error, setError] = useState<string | undefined>();
  const [addingTeamId, setAddingTeamId] = useState<string | undefined>();
  const [choosingTeam, setChoosingTeam] = useState(false);
  const [viewingKey, setViewingKey] = useState<{ teamId: string; eventId: string; startsAt: string } | undefined>();
  const viewing = events.find(
    (item) => item.teamId === viewingKey?.teamId && item.eventId === viewingKey?.eventId && item.startsAt === viewingKey?.startsAt,
  );
  const [editing, setEditing] = useState<{ item: TeamOccurrence; series: EventResponse } | undefined>();
  const [scopePrompt, setScopePrompt] = useState<
    | { kind: 'delete'; item: TeamOccurrence }
    | { kind: 'edit'; item: TeamOccurrence; body: UpdateEventBody }
    | undefined
  >();
  const focusedTeamId = viewing?.teamId ?? editing?.item.teamId ?? addingTeamId;
  useBrandTeam(focusedTeamId);
  const loadError = scheduleQueries.some((query) => queryError(query.error) !== undefined)
    ? t('errors.common.loadFailed')
    : undefined;
  const singleTeam = teams.length === 1;

  if (teams.length === 0) {
    return (
      <RefreshableScroll className="flex-1 px-4 pt-6">
        <Text>{t('schedule.empty')}</Text>
      </RefreshableScroll>
    );
  }

  const cells = buildMonthGrid(month.year, month.month, zone);
  const dayEvents = events.filter((item) => dayKeyInZone(new Date(item.startsAt), zone) === selected);
  const primaryMaps: MapsProvider = Platform.OS === 'ios' ? 'apple' : 'google';

  return (
    <RefreshableScroll className="flex-1 px-3 pt-3">
      <ErrorText message={error ?? loadError} />
      <IncomingFixtures fixtures={fixtures} teamIds={manageable.map((team) => team.teamId)} games={events} />
      <View className="mb-2 flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.prevMonth')}
          className="px-3 py-2"
          onPress={() => setMonth((current) => shiftCalendarMonth(current, -1))}
        >
          <ChevronLeft color={colors.ink} size={24} strokeWidth={2} />
        </Pressable>
        <Text className="mx-2 font-semibold text-ink">{monthTitle(month, zone, appLocale)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.nextMonth')}
          className="px-3 py-2"
          onPress={() => setMonth((current) => shiftCalendarMonth(current, 1))}
        >
          <ChevronRight color={colors.ink} size={24} strokeWidth={2} />
        </Pressable>
      </View>
      <View className="mb-2 flex-row">
        {weekdayLabelsForLocale(appLocale).map((label) => (
          <Text key={label} className="flex-1 text-center text-xs text-muted">
            {label}
          </Text>
        ))}
      </View>
      <View className="mb-4 flex-row flex-wrap">
        {cells.map((cell) => {
          const dayTypes = eventTypesOnDay(events, cell.key, zone);
          return (
            <Pressable key={cell.key} className="w-[14.28%] items-center py-2" onPress={() => setSelected(cell.key)}>
              <Text
                className={cell.key === selected ? 'font-bold text-ink' : cell.inMonth ? 'text-ink' : 'text-muted'}
                style={cell.key === selected && singleTeam ? { color: brand.accent } : undefined}
              >
                {cell.day}
              </Text>
              <View className="mt-1 h-1.5 flex-row">
                {dayTypes.map((type) => (
                  <View key={type} className="mx-px h-1.5 w-1.5 rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[type] }} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text className="mb-2 text-xl font-semibold text-ink">{dayTitle(selected, zone, appLocale)}</Text>
      {dayEvents.length === 0 ? <Text className="mb-3 text-base text-muted">{t('schedule.nothingScheduled')}</Text> : null}
      {dayEvents.map((item) => {
        const eventTeam = teams.find((team) => team.teamId === item.teamId);
        return (
          <EventRow
            key={`${item.teamId}-${item.eventId}-${item.startsAt}`}
            item={item}
            zone={zone}
            teamName={singleTeam ? undefined : eventTeam?.name}
            logoKey={singleTeam ? undefined : eventTeam?.theme?.logoKey}
            logoName={eventTeam?.name}
            userId={api.user?.userId}
            canManage={manageable.some((team) => team.teamId === item.teamId)}
            canDelete={manageable.some((team) => team.teamId === item.teamId) && item.fixtureId === undefined}
            onView={() => setViewingKey({ teamId: item.teamId, eventId: item.eventId, startsAt: item.startsAt })}
            onEdit={() => {
              const seriesId = item.seriesEventId ?? item.eventId;
              void queryClient
                .fetchQuery(eventQuery(api, item.teamId, seriesId))
                .then((series) => setEditing({ item, series }))
                .catch(() => setError(t('errors.common.loadFailed')));
            }}
            onDelete={() => {
              if (!item.recurring) {
                void deleteEvent
                  .mutateAsync({ teamId: item.teamId, eventId: item.eventId })
                  .catch(() => setError(t('errors.common.deleteFailed')));
                return;
              }
              setScopePrompt({ kind: 'delete', item });
            }}
            onRsvp={async (status) => {
              if (api.user === undefined) return;
              try {
                await putRsvp.mutateAsync({
                  teamId: item.teamId,
                  userId: api.user.userId,
                  body: {
                    eventId: item.eventId,
                    occurrenceStartsAt: item.startsAt,
                    status,
                  },
                });
              } catch {
                setError(t('errors.event.rsvpFailed'));
              }
            }}
          />
        );
      })}
      {manageable.length > 0 ? (
        <Button
          label={t('schedule.addEvent')}
          onPress={() => {
            const only = manageable.length === 1 ? manageable[0] : undefined;
            if (only !== undefined) setAddingTeamId(only.teamId);
            else setChoosingTeam(true);
          }}
        />
      ) : null}
      <Sheet
        visible={viewing !== undefined}
        title={viewing?.title ?? t('schedule.addEvent')}
        closeLabel={t('common.close')}
        onClose={() => setViewingKey(undefined)}
      >
        {viewing !== undefined ? (
          <EventDetail
            item={viewing}
            teamId={viewing.teamId}
            zone={teams.find((team) => team.teamId === viewing.teamId)?.timeZone ?? zone}
            teamName={singleTeam ? undefined : teams.find((team) => team.teamId === viewing.teamId)?.name}
            userId={api.user?.userId}
            maps={primaryMaps}
            canManage={manageable.some((team) => team.teamId === viewing.teamId)}
            canShare={manageable.some((team) => team.teamId === viewing.teamId)}
            fixture={fixtures.find((fixture) => fixture.fixtureId === viewing.fixtureId)}
            onRsvp={async (status) => {
              if (api.user === undefined) return;
              try {
                await putRsvp.mutateAsync({
                  teamId: viewing.teamId,
                  userId: api.user.userId,
                  body: {
                    eventId: viewing.eventId,
                    occurrenceStartsAt: viewing.startsAt,
                    status,
                  },
                });
              } catch {
                setError(t('errors.event.rsvpFailed'));
              }
            }}
          />
        ) : null}
      </Sheet>
      <Sheet
        visible={choosingTeam || addingTeamId !== undefined}
        title={addingTeamId === undefined ? t('schedule.chooseTeam') : t('schedule.addEvent')}
        closeLabel={t('common.cancel')}
        onClose={() => {
          setChoosingTeam(false);
          setAddingTeamId(undefined);
        }}
      >
        {addingTeamId === undefined ? (
          manageable.map((team) => (
            <Pressable
              key={team.teamId}
              className="mb-2 rounded-xl bg-inset p-4"
              onPress={() => {
                setAddingTeamId(team.teamId);
                setChoosingTeam(false);
              }}
            >
              <Text className="text-lg font-semibold text-ink">{team.name}</Text>
            </Pressable>
          ))
        ) : (
          <AddEvent
            key={addingTeamId}
            dayKey={selected}
            timeZone={teams.find((team) => team.teamId === addingTeamId)?.timeZone ?? zone}
            onCreate={async (body) => {
              const { endsAt, location, notes, latitude, longitude, recurrence, startsAt, opponentName, side, ...rest } = body;
              if (startsAt === undefined) return;
              await createEvent.mutateAsync({
                teamId: addingTeamId,
                body: {
                  ...rest,
                  title: rest.title ?? '',
                  eventType: rest.eventType ?? 'practice',
                  startsAt,
                  ...(endsAt !== undefined && endsAt !== null ? { endsAt } : {}),
                  ...(location !== undefined && location !== null ? { location } : {}),
                  ...(notes !== undefined && notes !== null ? { notes } : {}),
                  ...(latitude !== undefined && latitude !== null && longitude !== undefined && longitude !== null
                    ? { latitude, longitude }
                    : {}),
                  ...(recurrence !== undefined && recurrence !== null ? { recurrence } : {}),
                  ...(typeof opponentName === 'string' ? { opponentName } : {}),
                  ...(side !== undefined && side !== null ? { side } : {}),
                },
              });
              setAddingTeamId(undefined);
            }}
          />
        )}
      </Sheet>
      <Sheet
        visible={editing !== undefined}
        title={t('schedule.editEvent')}
        closeLabel={t('common.cancel')}
        onClose={() => setEditing(undefined)}
      >
        {editing !== undefined ? (
          <AddEvent
            key={`${editing.item.eventId}-${editing.item.startsAt}`}
            dayKey={dayKeyInZone(
              new Date(editing.item.startsAt),
              teams.find((team) => team.teamId === editing.item.teamId)?.timeZone ?? zone,
            )}
            timeZone={teams.find((team) => team.teamId === editing.item.teamId)?.timeZone ?? zone}
            initial={{ item: editing.item, series: editing.series }}
            onCreate={async (body) => {
              if (editing.item.fixtureId !== undefined && !editing.item.recurring) {
                const { startsAt, endsAt, location, latitude, longitude, title, notes } = body;
                if (startsAt !== undefined) {
                  await updateFixture.mutateAsync({
                    fixtureId: editing.item.fixtureId,
                    body: {
                      startsAt,
                      ...(endsAt !== undefined ? { endsAt } : {}),
                      ...(location !== undefined ? { location } : {}),
                      ...(latitude !== undefined ? { latitude } : {}),
                      ...(longitude !== undefined ? { longitude } : {}),
                    },
                  });
                }
                if (manageable.some((team) => team.teamId === editing.item.teamId)) {
                  await updateEvent.mutateAsync({
                    teamId: editing.item.teamId,
                    eventId: editing.item.eventId,
                    body: {
                      ...(title !== undefined ? { title } : {}),
                      ...(notes !== undefined ? { notes } : {}),
                    },
                  });
                }
                setEditing(undefined);
                return;
              }
              if (!editing.item.recurring) {
                await updateEvent.mutateAsync({ teamId: editing.item.teamId, eventId: editing.item.eventId, body });
                setEditing(undefined);
                return;
              }
              setScopePrompt({ kind: 'edit', item: editing.item, body });
            }}
          />
        ) : null}
      </Sheet>
      <ScopeChoice
        visible={scopePrompt !== undefined}
        title={scopePrompt?.kind === 'delete' ? t('schedule.scopeDelete') : t('schedule.scopeEdit')}
        onClose={() => setScopePrompt(undefined)}
        onChoose={async (scope) => {
          const prompt = scopePrompt;
          if (prompt === undefined) return;
          const seriesId = prompt.item.seriesEventId ?? prompt.item.eventId;
          const original = prompt.item.originalStartsAt ?? prompt.item.startsAt;
          if (prompt.kind === 'delete') {
            if (scope === 'one') {
              await cancelOccurrence.mutateAsync({
                teamId: prompt.item.teamId,
                eventId: seriesId,
                body: { occurrenceStartsAt: original },
              });
            } else await deleteEvent.mutateAsync({ teamId: prompt.item.teamId, eventId: seriesId });
          } else if (scope === 'one') {
            const { recurrence: _recurrence, ...rest } = prompt.body;
            await saveOccurrence.mutateAsync({
              teamId: prompt.item.teamId,
              eventId: seriesId,
              body: { ...rest, occurrenceStartsAt: original },
            });
          } else {
            const series = await queryClient.fetchQuery(eventQuery(api, prompt.item.teamId, seriesId));
            const nextStart = prompt.body.startsAt ?? prompt.item.startsAt;
            const delta = new Date(nextStart).getTime() - new Date(prompt.item.startsAt).getTime();
            const startsAt = new Date(new Date(series.startsAt).getTime() + delta).toISOString();
            const endsAt =
              prompt.body.endsAt === null || prompt.body.endsAt === undefined
                ? prompt.body.endsAt
                : new Date(
                    new Date(startsAt).getTime() +
                      (new Date(prompt.body.endsAt).getTime() - new Date(nextStart).getTime()),
                  ).toISOString();
            await updateEvent.mutateAsync({
              teamId: prompt.item.teamId,
              eventId: seriesId,
              body: { ...prompt.body, startsAt, endsAt },
            });
          }
          setScopePrompt(undefined);
          setEditing(undefined);
        }}
      />
    </RefreshableScroll>
  );
}
