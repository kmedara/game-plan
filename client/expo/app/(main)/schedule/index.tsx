/**
 * Month calendar, day list, RSVP, and add-event form.
 */

import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import MessageSquareText from 'lucide-react-native/icons/message-square-text';
import Pencil from 'lucide-react-native/icons/pencil';
import Phone from 'lucide-react-native/icons/phone';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCalendars } from 'expo-localization';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rolesFromMembership } from '@gameplan/rules';
import { deviceTimeZone, mergeSchedules, type TeamOccurrence } from '@/src/athlete-schedule';
import { EVENT_TYPES, RSVP_STATUSES, type EventResponse, type EventType, type Fixture, type GameSide, type RecurrenceRule, type RsvpStatus, type ScheduleList, type ScheduleOccurrence, type TeamMember, type UpdateEventBody } from '@gameplan/types';
import { GameFixture, IncomingFixtures } from '@/src/fixture-panel';
import { errorMessageKey, queryError } from '@/src/errors';
import { EventTimeFields } from '@/src/event-time';
import { RecurrenceFields } from '@/src/recurrence-fields';
import { recurrenceFromForm, type RepeatEnd, type RepeatFrequency } from '@/src/recurrence-form';
import { DEFAULT_START_MINUTES, DURATION_PRESETS, eventWindow, type EndChoice } from '@/src/event-window';
import { appLocale } from '@/src/i18n';
import { MapPicker } from '@/src/map-picker';
import { useDownloadUrl } from '@/src/media';
import { mapsUrl, type MapsProvider } from '@/src/maps';
import {
  buildMonthGrid,
  clockLabel,
  dayKeyInZone,
  dayTitle,
  minutesInZone,
  monthTitle,
  rruleWeekDay,
  shiftCalendarMonth,
  wallTimeToIso,
  weekdayLabelsForLocale,
  type CalendarMonth,
} from '@/src/schedule-calendar';
import { Sheet } from '@/src/sheet';
import { queryKeys } from '@/src/queries/keys';
import { RefreshableScroll } from '@/src/pull-refresh';
import { membersQuery } from '@/src/queries/teams';
import {
  cancelOccurrenceMutation,
  carpoolClaimMutation,
  carpoolOfferMutation,
  carpoolQuery,
  createEventMutation,
  deleteEventMutation,
  eventQuery,
  fixturesQuery,
  lineupMutation,
  lineupQuery,
  rsvpMutation,
  saveOccurrenceMutation,
  scheduleQuery,
  updateEventMutation,
  updateFixtureMutation,
} from '@/src/queries/schedule';
import { useApp, useBrandTeam } from '@/src/state';
import { useTeamsWithPermission } from '@/src/team-access';
import { timeZoneLabel } from '@/src/time-zones';
import { brandColors, colors, fieldWash, fieldWashOpacity } from '@/src/theme';
import { TrashIcon } from '@/src/team-media';
import { Button, ErrorText, Field, ProfilePhoto, SubmitButton } from '@/src/ui';

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
  useBrandTeam(teams.length > 1 ? focusedTeamId : undefined);
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
          const dotColors = dayDotColors(events, teams, cell.key, zone, singleTeam ? brand.accent : undefined);
          return (
            <Pressable key={cell.key} className="w-[14.28%] items-center py-2" onPress={() => setSelected(cell.key)}>
              <Text
                className={cell.key === selected ? 'font-bold text-ink' : cell.inMonth ? 'text-ink' : 'text-muted'}
                style={cell.key === selected && singleTeam ? { color: brand.accent } : undefined}
              >
                {cell.day}
              </Text>
              <View className="mt-1 h-1.5 flex-row">
                {dotColors.map((dot) => (
                  <View key={dot.teamId} className="mx-px h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot.color }} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text className="mb-2 text-lg font-semibold text-ink">{dayTitle(selected, zone, appLocale)}</Text>
      {dayEvents.length === 0 ? <Text className="mb-3 text-muted">{t('schedule.nothingScheduled')}</Text> : null}
      {dayEvents.map((item) => {
        const eventTeam = teams.find((team) => team.teamId === item.teamId);
        return (
          <EventRow
            key={`${item.teamId}-${item.eventId}-${item.startsAt}`}
            item={item}
            zone={zone}
            color={singleTeam ? undefined : brandColors(eventTeam?.theme).accent}
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

/** Row-action icon size and stroke. */
const ICON = { size: 16, color: colors.ink, strokeWidth: 2 } as const;

/** Translation key for an RSVP status. */
const rsvpLabelKey = (status: RsvpStatus): string =>
  status === 'not_going' ? 'schedule.notGoing' : `schedule.${status}`;

/** The device's 12/24-hour preference, or `undefined` to use the locale default. */
const useHour12 = (): boolean | undefined => {
  const uses24 = useCalendars()[0].uses24hourClock;
  return uses24 === null ? undefined : !uses24;
};

const RsvpChoices = ({
  mine,
  onRsvp,
}: {
  mine: RsvpStatus | undefined;
  onRsvp: (status: RsvpStatus) => Promise<void>;
}) => {
  const { t } = useTranslation();
  return (
    <View className="mt-2 flex-row">
      {RSVP_STATUSES.map((status) => (
        <Pressable
          key={status}
          className="mr-2 rounded-full px-3 py-1"
          style={mine === status ? { backgroundColor: fieldWash(rsvpColor(status), fieldWashOpacity.chip) } : undefined}
          onPress={() => {
            if (mine === status) return;
            void onRsvp(status);
          }}
        >
          <Text className="text-ink">{t(rsvpLabelKey(status))}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const dayDotColors = (
  events: readonly TeamOccurrence[],
  teams: readonly { teamId: string; theme?: { primary?: string; secondary?: string; accent?: string } }[],
  dayKey: string,
  zone: string,
  singleAccent: string | undefined,
): { teamId: string; color: string }[] => {
  const seen = new Set<string>();
  const colorsForDay: { teamId: string; color: string }[] = [];
  for (const item of events) {
    if (dayKeyInZone(new Date(item.startsAt), zone) !== dayKey || seen.has(item.teamId)) continue;
    seen.add(item.teamId);
    if (singleAccent !== undefined) return [{ teamId: item.teamId, color: singleAccent }];
    const team = teams.find((candidate) => candidate.teamId === item.teamId);
    colorsForDay.push({ teamId: item.teamId, color: brandColors(team?.theme).accent });
  }
  return colorsForDay;
};

const EventRow = ({
  item,
  zone,
  color,
  teamName,
  logoKey,
  logoName,
  userId,
  canManage,
  canDelete,
  onView,
  onEdit,
  onDelete,
  onRsvp,
}: {
  item: TeamOccurrence;
  zone: string;
  color: string | undefined;
  teamName: string | undefined;
  logoKey: string | undefined;
  logoName: string | undefined;
  userId: string | undefined;
  canManage: boolean;
  canDelete: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRsvp: (status: RsvpStatus) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const hour12 = useHour12();
  const logoUrl = useDownloadUrl(logoKey, { teamId: item.teamId });
  const mine = item.rsvps.find((rsvp) => rsvp.userId === userId)?.status;
  const showLogo = logoKey !== undefined;
  return (
    <View
      className="mb-3 rounded-xl bg-inset p-3"
      style={color === undefined ? undefined : { borderLeftWidth: 4, borderLeftColor: color }}
    >
      <Pressable accessibilityRole="button" onPress={onView}>
        <View className={showLogo ? 'pr-24' : canManage ? 'pr-16' : ''}>
          <Text className="font-semibold text-ink">{item.title}</Text>
          {teamName !== undefined ? <Text className="text-muted">{teamName}</Text> : null}
          <Text className="text-muted">
            {t(`eventType.${item.eventType}`)} · {clockLabel(item.startsAt, zone, appLocale, hour12)}
          </Text>
        </View>
        {item.location !== undefined || showLogo ? (
          <View style={{ overflow: 'visible' }}>
            {item.location !== undefined ? (
              <Text className={`text-link${showLogo ? ' pr-24' : ''}`}>{item.location}</Text>
            ) : (
              <View className="h-5" />
            )}
            {showLogo ? (
              <View
                className="absolute right-0 h-20 w-20 items-center justify-center"
                style={{ top: '50%', marginTop: -40 }}
                pointerEvents="none"
              >
                {logoUrl !== undefined ? (
                  <Image
                    source={{ uri: logoUrl }}
                    accessibilityLabel={logoName ?? t('teamAdmin.teamLogo')}
                    resizeMode="contain"
                    style={{ width: 80, height: 80 }}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>
      <View className={showLogo ? 'pr-24' : ''}>
        <RsvpChoices mine={mine} onRsvp={onRsvp} />
      </View>
      {canManage ? (
        <View className="absolute right-2 top-2 flex-row items-center">
          <Pressable accessibilityRole="button" accessibilityLabel={t('schedule.editEvent')} className="p-1.5" onPress={onEdit}>
            <Pencil {...ICON} />
          </Pressable>
          {canDelete ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('schedule.deleteEvent')} className="p-1.5" onPress={onDelete}>
              <TrashIcon />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const EventDetail = ({
  item,
  teamId,
  zone,
  teamName,
  userId,
  maps,
  canManage,
  canShare,
  fixture,
  onRsvp,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  zone: string;
  teamName: string | undefined;
  userId: string | undefined;
  maps: MapsProvider;
  canManage: boolean;
  canShare: boolean;
  fixture: Fixture | undefined;
  onRsvp: (status: RsvpStatus) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [error, setError] = useState<string | undefined>();
  const roster = useQuery(membersQuery(api, teamId)).data ?? [];
  const byId = new Map(roster.map((member) => [member.userId, member]));
  const hour12 = useHour12();
  const mine = item.rsvps.find((rsvp) => rsvp.userId === userId)?.status;
  const rsvpByUser = new Map(item.rsvps.map((rsvp) => [rsvp.userId, rsvp.status]));
  const noReply = roster.filter((member) => !rsvpByUser.has(member.userId));
  const short = roster.filter(
    (member) => rolesFromMembership(member).includes('player') && rsvpByUser.get(member.userId) !== 'going',
  ).length;
  const nameOf = (id: string): string => byId.get(id)?.displayName ?? t('common.unknownPerson');
  const openMaps = (): void => {
    if (item.location === undefined && item.latitude === undefined) return;
    const url = mapsUrl(
      { label: item.location ?? 'Event', latitude: item.latitude, longitude: item.longitude },
      maps,
    );
    void WebBrowser.openBrowserAsync(url);
  };
  return (
    <View>
      {teamName !== undefined ? <Text className="mb-1 font-semibold text-ink">{teamName}</Text> : null}
      <Text className="text-muted">
        {t(`eventType.${item.eventType}`)} · {clockLabel(item.startsAt, zone, appLocale, hour12)}
      </Text>
      <Text className="text-muted">{timeZoneLabel(zone, new Date(item.startsAt))}</Text>
      {item.location !== undefined ? (
        <Pressable className="mt-2" onPress={openMaps}>
          <Text className="text-link">{item.location}</Text>
        </Pressable>
      ) : (
        <Text className="mt-2 text-muted">{t('schedule.noLocation')}</Text>
      )}
      {item.notes !== undefined && item.notes.length > 0 ? (
        <View className="mt-3">
          <Text className="mb-1 font-semibold text-ink">{t('schedule.notes')}</Text>
          <Text className="text-ink">{item.notes}</Text>
        </View>
      ) : null}
      <GameFixture item={item} teamId={teamId} canShare={canShare} fixture={fixture} />
      {item.latitude !== undefined && item.longitude !== undefined ? (
        <View className="mt-3">
          <MapPicker latitude={item.latitude} longitude={item.longitude} readOnly />
        </View>
      ) : null}
      <Text className="mt-4 font-semibold text-ink">{t('schedule.yourRsvp')}</Text>
      <RsvpChoices mine={mine} onRsvp={onRsvp} />
      <Text className="mb-1 mt-4 font-semibold text-ink">{t('schedule.attendance')}</Text>
      <Text className="mb-2 text-muted">{t('schedule.short', { count: short })}</Text>
      <ErrorText message={error} />
      {RSVP_STATUSES.map((status) => {
        const rows = item.rsvps.filter((rsvp) => rsvp.status === status);
        return (
          <View key={status} className="mb-3">
            <Text className="mb-1 text-muted">
              {t(rsvpLabelKey(status))} · {rows.length}
            </Text>
            {rows.map((rsvp) => (
              <AttendanceRow
                key={rsvp.userId}
                userId={rsvp.userId}
                name={nameOf(rsvp.userId)}
                member={byId.get(rsvp.userId)}
                self={rsvp.userId === userId}
                onError={setError}
              />
            ))}
          </View>
        );
      })}
      <View className="mb-3">
        <Text className="mb-1 text-muted">{t('schedule.noReply')} · {noReply.length}</Text>
        {noReply.map((member) => (
          <AttendanceRow
            key={member.userId}
            userId={member.userId}
            name={nameOf(member.userId)}
            member={member}
            self={member.userId === userId}
            onError={setError}
          />
        ))}
      </View>
      <CarpoolSection
        item={item}
        teamId={teamId}
        userId={userId}
        nameOf={nameOf}
      />
      {item.eventType === 'game' ? (
        <LineupEditor item={item} teamId={teamId} roster={roster} canManage={canManage} nameOf={nameOf} />
      ) : null}
    </View>
  );
};

const AttendanceRow = ({
  userId,
  name,
  member,
  self,
  onError,
}: {
  userId: string;
  name: string;
  member: TeamMember | undefined;
  self: boolean;
  onError: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const router = useRouter();
  const photo = useDownloadUrl(member?.photoKey, { userId });
  const phone = member?.phoneNumber;
  return (
    <View className="mb-2 flex-row items-center">
      <ProfilePhoto name={name} uri={photo} size={36} />
      <Text className="ml-3 flex-1 text-ink">{name}</Text>
      {!self && phone !== undefined && phone.length > 0 ? (
        <View className="flex-row">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('schedule.call')}
            className="p-1.5"
            onPress={() => void Linking.openURL(`tel:${phone}`)}
          >
            <Phone {...ICON} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('schedule.text')}
            className="p-1.5"
            onPress={() => void Linking.openURL(`sms:${phone}`)}
          >
            <MessageSquareText {...ICON} />
          </Pressable>
        </View>
      ) : null}
      {!self && (phone === undefined || phone.length === 0) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.message')}
          className="p-1.5"
          onPress={() => {
            void api
              .createPrivateChat({ memberIds: [userId] })
              .then(async (chat) => {
                await queryClient.invalidateQueries({ queryKey: queryKeys.chats });
                router.push(`/chats/${chat.chatId}`);
              })
              .catch((err: unknown) => onError(t(errorMessageKey(err, 'errors.event.messageFailed'))));
          }}
        >
          <MessageCircle {...ICON} />
        </Pressable>
      ) : null}
    </View>
  );
};

const CarpoolSection = ({
  item,
  teamId,
  userId,
  nameOf,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  userId: string | undefined;
  nameOf: (id: string) => string;
}) => {
  const { t } = useTranslation();
  const { api, brand } = useApp();
  const queryClient = useQueryClient();
  const carpool = useQuery(carpoolQuery(api, teamId, item.eventId, item.startsAt));
  const offerSeats = useMutation(carpoolOfferMutation(api, queryClient));
  const claimRide = useMutation(carpoolClaimMutation(api, queryClient));
  const offers = carpool.data ?? [];
  const [error, setError] = useState<string | undefined>();
  const mine = offers.find((offer) => offer.userId === userId);
  const shown = error ?? (queryError(carpool.error) !== undefined ? t('errors.event.carpoolLoadFailed') : undefined);

  const saveSeats = (seats: number): void => {
    setError(undefined);
    void offerSeats
      .mutateAsync({
        teamId,
        body: { eventId: item.eventId, occurrenceStartsAt: item.startsAt, seats },
      })
      .catch((err: unknown) => setError(t(errorMessageKey(err, 'errors.event.carpoolSaveFailed'))));
  };

  const claim = (driverUserId: string): void => {
    setError(undefined);
    void claimRide
      .mutateAsync({
        teamId,
        body: {
          eventId: item.eventId,
          occurrenceStartsAt: item.startsAt,
          driverUserId,
        },
      })
      .catch((err: unknown) =>
        setError(
          t(
            errorMessageKey(err, 'errors.event.carpoolSaveFailed', {
              carpool_full: 'schedule.carpoolFull',
              carpool_own_offer: 'schedule.carpoolOwn',
            }),
          ),
        ),
      );
  };

  return (
    <View className="mt-2">
      <Text className="mb-1 font-semibold text-ink">{t('schedule.carpool')}</Text>
      {offers.length === 0 ? <Text className="mb-2 text-muted">{t('schedule.carpoolEmpty')}</Text> : null}
      {offers.map((offer) => {
        const riding = userId !== undefined && offer.riderIds.includes(userId);
        const full = offer.riderIds.length >= offer.seats;
        return (
          <View key={offer.userId} className="mb-3">
            <Text className="text-ink">{nameOf(offer.userId)}</Text>
            <Text className="text-muted">
              {t('schedule.seatsTaken', { taken: offer.riderIds.length, seats: offer.seats })}
            </Text>
            {offer.riderIds.length > 0 ? (
              <Text className="text-ink">
                {t('schedule.riders')}: {offer.riderIds.map((id) => nameOf(id)).join(', ')}
              </Text>
            ) : null}
            {offer.userId !== userId ? (
              <Pressable
                accessibilityRole="button"
                disabled={!riding && full}
                className="mt-1 self-start rounded-full border border-line bg-inset px-3 py-1.5"
                style={{ opacity: !riding && full ? 0.4 : 1 }}
                onPress={() => claim(offer.userId)}
              >
                <Text className="text-ink">{riding ? t('schedule.leaveRide') : t('schedule.claimRide')}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Text className="mb-1 text-muted">{t('schedule.offerSeats')}</Text>
      <View className="mb-2 flex-row flex-wrap">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((seats) => {
          const selected = mine?.seats === seats;
          return (
            <Pressable
              key={seats}
              accessibilityRole="button"
              className="mb-2 mr-2 h-10 w-10 items-center justify-center rounded-full border"
              style={{
                borderColor: selected ? brand.primary : colors.line,
                backgroundColor: selected ? brand.primary : colors.paper,
              }}
              onPress={() => saveSeats(seats)}
            >
              <Text style={{ color: selected ? brand.onPrimary : colors.ink }}>{seats}</Text>
            </Pressable>
          );
        })}
      </View>
      {mine !== undefined ? (
        <Pressable accessibilityRole="button" className="mb-2 self-start" onPress={() => saveSeats(0)}>
          <Text className="text-link">{t('schedule.clearOffer')}</Text>
        </Pressable>
      ) : null}
      <ErrorText message={shown} />
    </View>
  );
};

const LineupEditor = ({
  item,
  teamId,
  roster,
  canManage,
  nameOf,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  roster: TeamMember[];
  canManage: boolean;
  nameOf: (userId: string) => string;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const lineup = useQuery(lineupQuery(api, teamId, item.eventId, item.startsAt));
  const saveLineup = useMutation(lineupMutation(api, queryClient));
  const [slots, setSlots] = useState<typeof lineup.data>(undefined);
  const shownSlots = slots ?? lineup.data ?? [];
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const shown = error ?? (queryError(lineup.error) !== undefined ? t('errors.event.lineupLoadFailed') : undefined);

  useEffect(() => {
    setSlots(undefined);
  }, [item.eventId, item.startsAt]);

  const move = (index: number, direction: -1 | 1): void => {
    const next = index + direction;
    if (next < 0 || next >= shownSlots.length) return;
    const copy = [...shownSlots];
    const current = copy[index];
    const swap = copy[next];
    if (current === undefined || swap === undefined) return;
    copy[index] = swap;
    copy[next] = current;
    setSlots(copy);
  };

  const save = async (): Promise<void> => {
    setError(undefined);
    const saved = await saveLineup.mutateAsync({
      teamId,
      body: {
        eventId: item.eventId,
        occurrenceStartsAt: item.startsAt,
        slots: shownSlots,
      },
    });
    setSlots(saved.slots);
    setNotice(t('schedule.lineupSaved'));
  };

  const copyPrevious = async (): Promise<void> => {
    setError(undefined);
    const previous = await api.getLineup(teamId, {
      eventId: item.eventId,
      occurrenceStartsAt: item.startsAt,
      source: 'previous',
    });
    if (previous.slots.length === 0 || previous.occurrenceStartsAt === item.startsAt) {
      setNotice(t('schedule.noPreviousLineup'));
      return;
    }
    setSlots(previous.slots);
    setNotice(t('schedule.lineupCopied'));
  };

  const available = roster.filter((member) => !shownSlots.some((slot) => slot.userId === member.userId));

  return (
    <View className="mt-2">
      <Text className="mb-2 font-semibold text-ink">{t('schedule.lineup')}</Text>
      <ErrorText message={shown} />
      {notice !== undefined ? <Text className="mb-2 text-muted">{notice}</Text> : null}
      {shownSlots.length === 0 ? <Text className="mb-2 text-muted">{t('schedule.lineupEmpty')}</Text> : null}
      {shownSlots.map((slot, index) => (
        <View key={slot.userId} className="mb-3">
          <Text className="mb-1 text-ink">{nameOf(slot.userId)}</Text>
          {canManage ? (
            <Field
              label={t('schedule.position')}
              value={slot.position}
              onChangeText={(position) => {
                setSlots(shownSlots.map((row) => (row.userId === slot.userId ? { ...row, position } : row)));
              }}
            />
          ) : (
            <Text className="text-muted">{slot.position}</Text>
          )}
          {canManage ? (
            <View className="flex-row">
              <Button label={t('schedule.moveUp')} tone="secondary" onPress={() => move(index, -1)} />
              <Button label={t('schedule.moveDown')} tone="secondary" onPress={() => move(index, 1)} />
              <Button
                label={t('schedule.removeFromLineup')}
                tone="secondary"
                onPress={() => setSlots(shownSlots.filter((row) => row.userId !== slot.userId))}
              />
            </View>
          ) : null}
        </View>
      ))}
      {canManage && adding ? (
        <View className="mb-3">
          {available.map((member) => (
            <Pressable
              key={member.userId}
              className="mb-2"
              onPress={() => {
                setSlots([...shownSlots, { userId: member.userId, position: member.positions?.[0] ?? 'Player' }]);
                setAdding(false);
              }}
            >
              <Text className="text-link">{nameOf(member.userId)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {canManage ? (
        <View>
          <Button label={t('schedule.addToLineup')} tone="secondary" onPress={() => setAdding(true)} />
          <Button label={t('schedule.copyPrevious')} tone="secondary" onPress={() => void copyPrevious().catch(() => setError(t('errors.event.lineupCopyFailed')))} />
          <SubmitButton label={t('schedule.saveLineup')} onPress={save} />
        </View>
      ) : null}
    </View>
  );
};

const ScopeChoice = ({
  visible,
  title,
  onClose,
  onChoose,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onChoose: (scope: 'one' | 'all') => Promise<void>;
}) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | undefined>();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full rounded-2xl bg-raised p-4">
          <Text className="mb-4 text-base text-ink">{title}</Text>
          <ErrorText message={error} />
          <Button
            label={t('schedule.thisOccurrence')}
            onPress={() => {
              void onChoose('one').catch((err: unknown) => {
                setError(t(errorMessageKey(err, 'errors.common.saveFailed')));
              });
            }}
          />
          <Button
            label={t('schedule.allOccurrences')}
            tone="secondary"
            onPress={() => {
              void onChoose('all').catch((err: unknown) => {
                setError(t(errorMessageKey(err, 'errors.common.saveFailed')));
              });
            }}
          />
          <Button label={t('common.cancel')} tone="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
};

const rsvpColor = (status: RsvpStatus): string => {
  if (status === 'going') return colors.safety;
  if (status === 'not_going') return colors.danger;
  return colors.caution;
};

const endChoiceFor = (startsAt: string, endsAt: string | undefined, timeZone: string): EndChoice => {
  if (endsAt === undefined) return { kind: 'none' };
  const duration = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
  if ((DURATION_PRESETS as readonly number[]).includes(duration)) {
    return { kind: 'minutes', minutes: duration as (typeof DURATION_PRESETS)[number] };
  }
  return { kind: 'clock', minutes: minutesInZone(new Date(endsAt), timeZone) };
};

const repeatFromSeries = (
  rule: RecurrenceRule | undefined,
  timeZone: string,
): { frequency: RepeatFrequency; interval: string; byWeekDay: string[]; end: RepeatEnd } => {
  if (rule === undefined) {
    return { frequency: 'once', interval: '1', byWeekDay: [], end: { kind: 'never' } };
  }
  const end: RepeatEnd =
    rule.count !== undefined
      ? { kind: 'count', count: rule.count }
      : rule.until !== undefined
        ? { kind: 'until', dayKey: dayKeyInZone(new Date(rule.until), timeZone) }
        : { kind: 'never' };
  return {
    frequency: rule.frequency,
    interval: String(rule.interval ?? 1),
    byWeekDay: rule.byWeekDay ?? [],
    end,
  };
};

const AddEvent = ({
  dayKey,
  timeZone,
  initial,
  onCreate,
}: {
  dayKey: string;
  timeZone: string;
  initial?: { item: ScheduleOccurrence; series: EventResponse };
  onCreate: (body: UpdateEventBody) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const seeded = initial === undefined ? undefined : repeatFromSeries(initial.series.recurrence, timeZone);
  const [eventType, setEventType] = useState<EventType>(initial?.item.eventType ?? 'practice');
  const [title, setTitle] = useState(initial?.item.title ?? '');
  const [opponentName, setOpponentName] = useState(initial?.item.opponentName ?? '');
  const [side, setSide] = useState<GameSide | undefined>(initial?.item.side);
  const [startMinutes, setStartMinutes] = useState(
    initial === undefined ? DEFAULT_START_MINUTES : minutesInZone(new Date(initial.item.startsAt), timeZone),
  );
  const [end, setEnd] = useState<EndChoice>(
    initial === undefined ? { kind: 'none' } : endChoiceFor(initial.item.startsAt, initial.item.endsAt, timeZone),
  );
  const [location, setLocation] = useState(initial?.item.location ?? '');
  const [notes, setNotes] = useState(initial?.item.notes ?? '');
  const [query, setQuery] = useState(initial?.item.location ?? '');
  const [suggestions, setSuggestions] = useState<Array<{ id: string; primaryText: string; secondaryText?: string }>>([]);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | undefined>(
    initial?.item.latitude !== undefined && initial.item.longitude !== undefined
      ? { latitude: initial.item.latitude, longitude: initial.item.longitude }
      : undefined,
  );
  const [frequency, setFrequency] = useState<RepeatFrequency>(seeded?.frequency ?? 'once');
  const [interval, setInterval] = useState(seeded?.interval ?? '1');
  const [byWeekDay, setByWeekDay] = useState<string[]>(
    seeded !== undefined && seeded.byWeekDay.length > 0 ? seeded.byWeekDay : [rruleWeekDay(dayKey)],
  );
  const [repeatEnd, setRepeatEnd] = useState<RepeatEnd>(seeded?.end ?? { kind: 'never' });
  useEffect(() => {
    const handle = setTimeout(() => {
      if (query.trim().length === 0) {
        setSuggestions([]);
        return;
      }
      void api.autocompletePlaces(query.trim()).then(setSuggestions).catch(() => setSuggestions([]));
    }, 500);
    return () => clearTimeout(handle);
  }, [api, query]);

  const submit = async (): Promise<boolean | void> => {
    if (title.trim().length === 0) return false;
    if (eventType === 'game' && side === undefined) return false;
    const window = eventWindow(timeZone, dayKey, startMinutes, end);
    const { startsAt, endsAt } = window;
    const recurrence = recurrenceFromForm({
      frequency,
      interval: Number(interval),
      byWeekDay,
      end: repeatEnd,
      timeZone,
      dayKey,
      startMinutes,
    });
    await onCreate({
      eventType,
      title: title.trim(),
      startsAt,
      endsAt: endsAt ?? null,
      location: location.trim().length > 0 ? location.trim() : null,
      notes: notes.trim().length > 0 ? notes.trim() : null,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      recurrence: recurrence ?? null,
      ...(eventType === 'game'
        ? {
            opponentName: opponentName.trim().length > 0 ? opponentName.trim() : null,
            side: side ?? null,
          }
        : { opponentName: null, side: null }),
    });
  };

  return (
    <View className="mb-8">
      <View className="mb-2 flex-row flex-wrap">
        {EVENT_TYPES.map((type) => (
          <Pressable key={type} className="mr-3" onPress={() => setEventType(type)}>
            <Text className={eventType === type ? 'font-bold' : ''}>{t(`eventType.${type}`)}</Text>
          </Pressable>
        ))}
      </View>
      <Field label={t('addEvent.title')} value={title} onChangeText={setTitle} />
      {eventType === 'game' ? (
        <>
          <Field label={t('schedule.opponent')} value={opponentName} onChangeText={setOpponentName} />
          <View className="mb-2 flex-row">
            {(['home', 'away'] as const).map((choice) => (
              <Pressable key={choice} className="mr-3" onPress={() => setSide(choice)}>
                <Text className={side === choice ? 'font-bold' : ''}>{t(`schedule.${choice}`)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <EventTimeFields
        dayKey={dayKey}
        timeZone={timeZone}
        startMinutes={startMinutes}
        end={end}
        onChangeStart={setStartMinutes}
        onChangeEnd={setEnd}
      />
      <Field
        label={t('addEvent.notes')}
        value={notes}
        onChangeText={setNotes}
        multiline
      />
      <Field label={t('addEvent.location')} value={query} onChangeText={(value) => { setQuery(value); setLocation(value); setCoords(undefined); }} />
      {suggestions.map((suggestion) => (
        <Pressable
          key={suggestion.id}
          className="mb-1"
          onPress={() => {
            void api.resolvePlace(suggestion.id).then((place) => {
              setLocation(place.label);
              setQuery(place.label);
              setCoords({ latitude: place.latitude, longitude: place.longitude });
              setSuggestions([]);
            });
          }}
        >
          <Text>{suggestion.secondaryText === undefined ? suggestion.primaryText : `${suggestion.primaryText}, ${suggestion.secondaryText}`}</Text>
        </Pressable>
      ))}
      <MapPicker
        latitude={coords?.latitude}
        longitude={coords?.longitude}
        onPick={(pick) => {
          setCoords(pick);
          void api.reverseGeocodePlace(pick.latitude, pick.longitude).then((place) => {
            setLocation(place.label);
            setQuery(place.label);
          }).catch(() => setLocation(`${pick.latitude}, ${pick.longitude}`));
        }}
      />
      <RecurrenceFields
        frequency={frequency}
        interval={interval}
        byWeekDay={byWeekDay}
        end={repeatEnd}
        onChangeFrequency={(next) => {
          setFrequency(next);
          if (next === 'WEEKLY' && byWeekDay.length === 0) setByWeekDay([rruleWeekDay(dayKey)]);
        }}
        onChangeInterval={setInterval}
        onChangeWeekDays={setByWeekDay}
        onChangeEnd={setRepeatEnd}
      />
      <SubmitButton
        label={t('common.save')}
        onPress={submit}
        message={(err) => t(errorMessageKey(err, 'errors.common.saveFailed'))}
      />
    </View>
  );
};
