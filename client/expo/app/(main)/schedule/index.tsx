/**
 * Month calendar, day list, RSVP, and add-event form.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCalendars } from 'expo-localization';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EVENT_TYPES, RSVP_STATUSES, type CarpoolOffer, type EventResponse, type EventType, type LineupSlot, type RecurrenceRule, type RsvpStatus, type ScheduleOccurrence, type TeamMember, type UpdateEventBody } from '@gameplan/types';
import { EventTimeFields } from '@/src/event-time';
import { RecurrenceFields } from '@/src/recurrence-fields';
import { recurrenceFromForm, type RepeatEnd, type RepeatFrequency } from '@/src/recurrence-form';
import { DEFAULT_START_MINUTES, DURATION_PRESETS, eventWindow, type EndChoice } from '@/src/event-window';
import { appLocale } from '@/src/i18n';
import { MapPicker } from '@/src/map-picker';
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
import { heldRoles, memberHasPermission } from '@/src/roles';
import { Sheet } from '@/src/sheet';
import { useActiveTeam, useApp } from '@/src/state';
import { colors, fieldWash, fieldWashOpacity } from '@/src/theme';
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
  const { api, live, brand } = useApp();
  const { team } = useActiveTeam();
  const zone = team?.timeZone ?? 'UTC';
  const [month, setMonth] = useState<CalendarMonth>(() => {
    const key = dayKeyInZone(new Date(), 'UTC');
    const [year, monthNumber] = key.split('-').map(Number) as [number, number];
    return { year, month: monthNumber };
  });
  const [selected, setSelected] = useState(() => dayKeyInZone(new Date(), 'UTC'));
  const [events, setEvents] = useState<ScheduleOccurrence[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<ScheduleOccurrence | undefined>();
  const [editing, setEditing] = useState<{ item: ScheduleOccurrence; series: EventResponse } | undefined>();
  const [scopePrompt, setScopePrompt] = useState<
    | { kind: 'delete'; item: ScheduleOccurrence }
    | { kind: 'edit'; item: ScheduleOccurrence; body: UpdateEventBody }
    | undefined
  >();

  const load = async (teamId: string, visible: CalendarMonth, timeZone: string): Promise<void> => {
    const range = monthRange(visible, timeZone);
    const schedule = await api.getSchedule(teamId, range.from, range.to);
    setEvents(schedule.occurrences);
  };

  useEffect(() => {
    if (team === undefined) return;
    void load(team.teamId, month, zone).catch(() => setError('load_failed'));
    void api
      .getPermissions(team.teamId)
      .then((permissions) => {
        setCanManage(memberHasPermission(heldRoles(team), permissions.roles, 'manage_events'));
      })
      .catch(() => setCanManage(false));
  }, [team?.teamId, month.year, month.month]);

  useEffect(() => {
    return live.subscribe((event) => {
      if (
        (event.type === 'schedule_changed' ||
          event.type === 'event_moved' ||
          event.type === 'event_reminder') &&
        event.teamId === team?.teamId
      ) {
        void load(event.teamId, month, zone);
      }
    });
  }, [live, team?.teamId, month, zone]);

  if (team === undefined) {
    return (
      <View className="flex-1 px-4 pt-6">
        <Text>{t('schedule.empty')}</Text>
      </View>
    );
  }

  const cells = buildMonthGrid(month.year, month.month, zone);
  const dayEvents = events.filter((item) => dayKeyInZone(new Date(item.startsAt), zone) === selected);
  const primaryMaps: MapsProvider = Platform.OS === 'ios' ? 'apple' : 'google';

  return (
    <ScrollView className="flex-1 px-3 pt-3">
      <ErrorText message={error} />
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
          const has = events.some((item) => dayKeyInZone(new Date(item.startsAt), zone) === cell.key);
          return (
            <Pressable key={cell.key} className="w-[14.28%] items-center py-2" onPress={() => setSelected(cell.key)}>
              <Text
                className={cell.key === selected ? 'font-bold' : cell.inMonth ? 'text-ink' : 'text-muted'}
                style={cell.key === selected ? { color: brand.accent } : undefined}
              >
                {cell.day}
              </Text>
              <View
                className="mt-1 h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: has ? brand.accent : 'transparent' }}
              />
            </Pressable>
          );
        })}
      </View>
      <Text className="mb-2 text-lg font-semibold text-ink">{dayTitle(selected, zone, appLocale)}</Text>
      {dayEvents.length === 0 ? <Text className="mb-3 text-muted">{t('schedule.nothingScheduled')}</Text> : null}
      {dayEvents.map((item) => (
        <EventRow
          key={`${item.eventId}-${item.startsAt}`}
          item={item}
          zone={zone}
          userId={api.user?.userId}
          canManage={canManage}
          onView={() => setViewing(item)}
          onEdit={() => {
            const seriesId = item.seriesEventId ?? item.eventId;
            void api
              .getEvent(team.teamId, seriesId)
              .then((series) => setEditing({ item, series }))
              .catch(() => setError('load_failed'));
          }}
          onDelete={() => {
            if (!item.recurring) {
              void api
                .deleteEvent(team.teamId, item.eventId)
                .then(() => load(team.teamId, month, zone))
                .catch(() => setError('delete_failed'));
              return;
            }
            setScopePrompt({ kind: 'delete', item });
          }}
          onRsvp={async (status) => {
            try {
              await api.putRsvp(team.teamId, {
                eventId: item.eventId,
                occurrenceStartsAt: item.startsAt,
                status,
              });
              await load(team.teamId, month, zone);
            } catch {
              setError('rsvp_failed');
            }
          }}
        />
      ))}
      {canManage ? <Button label={t('schedule.addEvent')} onPress={() => setAdding(true)} /> : null}
      <Sheet
        visible={viewing !== undefined}
        title={viewing?.title ?? t('schedule.addEvent')}
        closeLabel={t('common.close')}
        onClose={() => setViewing(undefined)}
      >
        {viewing !== undefined ? (
          <EventDetail
            item={viewing}
            teamId={team.teamId}
            zone={zone}
            userId={api.user?.userId}
            maps={primaryMaps}
            canManage={canManage}
            onRsvp={async (status) => {
              try {
                await api.putRsvp(team.teamId, {
                  eventId: viewing.eventId,
                  occurrenceStartsAt: viewing.startsAt,
                  status,
                });
                await load(team.teamId, month, zone);
                setViewing((current) =>
                  current === undefined
                    ? current
                    : {
                        ...current,
                        rsvps: [
                          ...current.rsvps.filter((rsvp) => rsvp.userId !== api.user?.userId),
                          ...(api.user === undefined ? [] : [{ userId: api.user.userId, status }]),
                        ],
                      },
                );
              } catch {
                setError('rsvp_failed');
              }
            }}
          />
        ) : null}
      </Sheet>
      <Sheet
        visible={adding}
        title={t('schedule.addEvent')}
        closeLabel={t('common.cancel')}
        onClose={() => setAdding(false)}
      >
        <AddEvent
          dayKey={selected}
          timeZone={zone}
          onCreate={async (body) => {
            const { endsAt, location, notes, latitude, longitude, recurrence, startsAt, ...rest } = body;
            if (startsAt === undefined) return;
            await api.createEvent(team.teamId, {
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
            });
            setAdding(false);
            await load(team.teamId, month, zone);
          }}
        />
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
            dayKey={dayKeyInZone(new Date(editing.item.startsAt), zone)}
            timeZone={zone}
            initial={{ item: editing.item, series: editing.series }}
            onCreate={async (body) => {
              if (!editing.item.recurring) {
                await api.updateEvent(team.teamId, editing.item.eventId, body);
                setEditing(undefined);
                await load(team.teamId, month, zone);
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
            if (scope === 'one') await api.cancelOccurrence(team.teamId, seriesId, { occurrenceStartsAt: original });
            else await api.deleteEvent(team.teamId, seriesId);
          } else if (scope === 'one') {
            const { recurrence: _recurrence, ...rest } = prompt.body;
            await api.saveOccurrence(team.teamId, seriesId, { ...rest, occurrenceStartsAt: original });
          } else {
            const series = await api.getEvent(team.teamId, seriesId);
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
            await api.updateEvent(team.teamId, seriesId, { ...prompt.body, startsAt, endsAt });
          }
          setScopePrompt(undefined);
          setEditing(undefined);
          await load(team.teamId, month, zone);
        }}
      />
    </ScrollView>
  );
}

const PencilIcon = () => (
  <View className="h-4 w-4 items-center justify-center" style={{ transform: [{ rotate: '-45deg' }] }}>
    <View className="h-2 w-1.5 rounded-t-sm bg-ink" />
    <View className="h-1 w-1.5 bg-muted" />
    <View
      style={{
        width: 0,
        height: 0,
        borderLeftWidth: 3,
        borderRightWidth: 3,
        borderTopWidth: 4,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderTopColor: colors.ink,
      }}
    />
  </View>
);

const PhoneIcon = () => (
  <View className="h-4 w-4 items-center justify-center" style={{ transform: [{ rotate: '135deg' }] }}>
    <View className="h-3.5 w-3.5 rounded-lg border-2 border-ink" />
  </View>
);

const TextIcon = () => (
  <View className="h-4 w-4 items-end justify-end">
    <View className="h-3 w-3.5 rounded-md border-2 border-ink" />
    <View className="absolute bottom-0 right-0 h-1.5 w-1.5 border-b-2 border-r-2 border-ink" />
  </View>
);

const ChatIcon = () => (
  <View className="h-4 w-4 justify-center">
    <View className="h-3 w-4 rounded-md border-2 border-ink" />
    <View className="ml-1 h-1 w-1 border-b-2 border-l-2 border-ink" />
  </View>
);

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
          onPress={() => void onRsvp(status)}
        >
          <Text className="text-ink">
            {t(status === 'not_going' ? 'schedule.notGoing' : `schedule.${status}`)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};

const EventRow = ({
  item,
  zone,
  userId,
  canManage,
  onView,
  onEdit,
  onDelete,
  onRsvp,
}: {
  item: ScheduleOccurrence;
  zone: string;
  userId: string | undefined;
  canManage: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRsvp: (status: RsvpStatus) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const uses24 = useCalendars()[0].uses24hourClock;
  const hour12 = uses24 === null ? undefined : !uses24;
  const mine = item.rsvps.find((rsvp) => rsvp.userId === userId)?.status;
  return (
    <View className="mb-3 rounded-xl bg-inset p-3">
      <Pressable accessibilityRole="button" className={canManage ? 'pr-16' : ''} onPress={onView}>
        <Text className="font-semibold text-ink">{item.title}</Text>
        <Text className="text-muted">
          {t(`eventType.${item.eventType}`)} · {clockLabel(item.startsAt, zone, appLocale, hour12)}
        </Text>
        {item.location !== undefined ? <Text className="text-link">{item.location}</Text> : null}
      </Pressable>
      <RsvpChoices mine={mine} onRsvp={onRsvp} />
      {canManage ? (
        <View className="absolute right-2 top-2 flex-row items-center">
          <Pressable accessibilityRole="button" accessibilityLabel={t('schedule.editEvent')} className="p-1.5" onPress={onEdit}>
            <PencilIcon />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('schedule.deleteEvent')} className="p-1.5" onPress={onDelete}>
            <TrashIcon />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

const EventDetail = ({
  item,
  teamId,
  zone,
  userId,
  maps,
  canManage,
  onRsvp,
}: {
  item: ScheduleOccurrence;
  teamId: string;
  zone: string;
  userId: string | undefined;
  maps: MapsProvider;
  canManage: boolean;
  onRsvp: (status: RsvpStatus) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const router = useRouter();
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [people, setPeople] = useState<
    Record<string, { name: string | undefined; photo: string | undefined; phone: string | undefined }>
  >({});

  useEffect(() => {
    let cancelled = false;
    void api.listMembers(teamId).then((members) => {
      if (!cancelled) setRoster(members);
    }).catch(() => {
      if (!cancelled) setRoster([]);
    });
    return () => {
      cancelled = true;
    };
  }, [api, teamId]);

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set([...roster.map((member) => member.userId), ...item.rsvps.map((rsvp) => rsvp.userId)])];
    void Promise.all(
      ids.map(async (id) => {
        try {
          const member = await api.getMember(teamId, id);
          const photo =
            member.photoKey === undefined
              ? undefined
              : (await api.presignDownload(member.photoKey, { userId: id })).downloadUrl;
          return [id, { name: member.displayName, photo, phone: member.phoneNumber }] as const;
        } catch {
          return [id, { name: undefined, photo: undefined, phone: undefined }] as const;
        }
      }),
    ).then((rows) => {
      if (!cancelled) setPeople(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
  }, [api, teamId, roster, item.rsvps]);
  const uses24 = useCalendars()[0].uses24hourClock;
  const hour12 = uses24 === null ? undefined : !uses24;
  const mine = item.rsvps.find((rsvp) => rsvp.userId === userId)?.status;
  const rsvpByUser = new Map(item.rsvps.map((rsvp) => [rsvp.userId, rsvp.status]));
  const noReply = roster.filter((member) => !rsvpByUser.has(member.userId));
  const short = roster.filter(
    (member) => heldRoles(member).includes('player') && rsvpByUser.get(member.userId) !== 'going',
  ).length;
  const nameOf = (id: string): string =>
    people[id]?.name ?? roster.find((member) => member.userId === id)?.displayName ?? t('common.unknownPerson');
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
      <Text className="text-muted">
        {t(`eventType.${item.eventType}`)} · {clockLabel(item.startsAt, zone, appLocale, hour12)}
      </Text>
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
      {item.latitude !== undefined && item.longitude !== undefined ? (
        <View className="mt-3">
          <MapPicker latitude={item.latitude} longitude={item.longitude} readOnly />
        </View>
      ) : null}
      <Text className="mt-4 font-semibold text-ink">{t('schedule.yourRsvp')}</Text>
      <RsvpChoices mine={mine} onRsvp={onRsvp} />
      <Text className="mb-1 mt-4 font-semibold text-ink">{t('schedule.attendance')}</Text>
      <Text className="mb-2 text-muted">{t('schedule.short', { count: short })}</Text>
      {RSVP_STATUSES.map((status) => {
        const rows = item.rsvps.filter((rsvp) => rsvp.status === status);
        return (
          <View key={status} className="mb-3">
            <Text className="mb-1 text-muted">
              {t(status === 'not_going' ? 'schedule.notGoing' : `schedule.${status}`)} · {rows.length}
            </Text>
            {rows.map((rsvp) => (
              <AttendanceRow
                key={rsvp.userId}
                userId={rsvp.userId}
                name={nameOf(rsvp.userId)}
                photo={people[rsvp.userId]?.photo}
                phone={people[rsvp.userId]?.phone}
                self={rsvp.userId === userId}
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
            photo={people[member.userId]?.photo}
            phone={people[member.userId]?.phone}
            self={member.userId === userId}
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
  photo,
  phone,
  self,
}: {
  userId: string;
  name: string;
  photo: string | undefined;
  phone: string | undefined;
  self: boolean;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const router = useRouter();
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
            <PhoneIcon />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('schedule.text')}
            className="p-1.5"
            onPress={() => void Linking.openURL(`sms:${phone}`)}
          >
            <TextIcon />
          </Pressable>
        </View>
      ) : null}
      {!self && (phone === undefined || phone.length === 0) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.message')}
          className="p-1.5"
          onPress={() => {
            void api.createPrivateChat([userId]).then((chat) => {
              router.push(`/chats/${chat.chatId}`);
            });
          }}
        >
          <ChatIcon />
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
  const [offers, setOffers] = useState<CarpoolOffer[]>([]);
  const [error, setError] = useState<string | undefined>();
  const mine = offers.find((offer) => offer.userId === userId);

  useEffect(() => {
    let cancelled = false;
    void api
      .getCarpool(teamId, { eventId: item.eventId, occurrenceStartsAt: item.startsAt })
      .then((carpool) => {
        if (!cancelled) setOffers(carpool.offers);
      })
      .catch(() => {
        if (!cancelled) setError('carpool_load_failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, teamId, item.eventId, item.startsAt]);

  const saveSeats = (seats: number): void => {
    setError(undefined);
    void api
      .putCarpool(teamId, { eventId: item.eventId, occurrenceStartsAt: item.startsAt, seats })
      .then((carpool) => setOffers(carpool.offers))
      .catch(() => setError('carpool_save_failed'));
  };

  const claim = (driverUserId: string): void => {
    setError(undefined);
    void api
      .claimCarpool(teamId, {
        eventId: item.eventId,
        occurrenceStartsAt: item.startsAt,
        driverUserId,
      })
      .then((carpool) => setOffers(carpool.offers))
      .catch((caught: unknown) => {
        const code = caught instanceof Error ? caught.message : '';
        if (code === 'carpool_full') setError(t('schedule.carpoolFull'));
        else if (code === 'carpool_own_offer') setError(t('schedule.carpoolOwn'));
        else setError('carpool_save_failed');
      });
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
                borderColor: selected ? brand.primary : '#c5d0c9',
                backgroundColor: selected ? brand.primary : '#ffffff',
              }}
              onPress={() => saveSeats(seats)}
            >
              <Text style={{ color: selected ? brand.onPrimary : '#101412' }}>{seats}</Text>
            </Pressable>
          );
        })}
      </View>
      {mine !== undefined ? (
        <Pressable accessibilityRole="button" className="mb-2 self-start" onPress={() => saveSeats(0)}>
          <Text className="text-link">{t('schedule.clearOffer')}</Text>
        </Pressable>
      ) : null}
      <ErrorText message={error} />
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
  const [slots, setSlots] = useState<LineupSlot[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    void api
      .getLineup(teamId, { eventId: item.eventId, occurrenceStartsAt: item.startsAt })
      .then((lineup) => {
        if (!cancelled) setSlots(lineup.slots);
      })
      .catch(() => {
        if (!cancelled) setError('lineup_load_failed');
      });
    return () => {
      cancelled = true;
    };
  }, [api, teamId, item.eventId, item.startsAt]);

  const move = (index: number, direction: -1 | 1): void => {
    const next = index + direction;
    if (next < 0 || next >= slots.length) return;
    const copy = [...slots];
    const current = copy[index];
    const swap = copy[next];
    if (current === undefined || swap === undefined) return;
    copy[index] = swap;
    copy[next] = current;
    setSlots(copy);
  };

  const save = async (): Promise<void> => {
    setError(undefined);
    const lineup = await api.putLineup(teamId, {
      eventId: item.eventId,
      occurrenceStartsAt: item.startsAt,
      slots,
    });
    setSlots(lineup.slots);
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

  const available = roster.filter((member) => !slots.some((slot) => slot.userId === member.userId));

  return (
    <View className="mt-2">
      <Text className="mb-2 font-semibold text-ink">{t('schedule.lineup')}</Text>
      <ErrorText message={error} />
      {notice !== undefined ? <Text className="mb-2 text-muted">{notice}</Text> : null}
      {slots.length === 0 ? <Text className="mb-2 text-muted">{t('schedule.lineupEmpty')}</Text> : null}
      {slots.map((slot, index) => (
        <View key={slot.userId} className="mb-3">
          <Text className="mb-1 text-ink">{nameOf(slot.userId)}</Text>
          {canManage ? (
            <Field
              label={t('schedule.position')}
              value={slot.position}
              onChangeText={(position) => {
                setSlots(slots.map((row) => (row.userId === slot.userId ? { ...row, position } : row)));
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
                onPress={() => setSlots(slots.filter((row) => row.userId !== slot.userId))}
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
                void api.getMember(teamId, member.userId).then((profile) => {
                  const position = profile.positions?.[0] ?? 'Player';
                  setSlots([...slots, { userId: member.userId, position }]);
                  setAdding(false);
                }).catch(() => {
                  setSlots([...slots, { userId: member.userId, position: 'Player' }]);
                  setAdding(false);
                });
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
          <Button label={t('schedule.copyPrevious')} tone="secondary" onPress={() => void copyPrevious().catch(() => setError('lineup_copy_failed'))} />
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
                setError(err instanceof Error ? err.message : 'save_failed');
              });
            }}
          />
          <Button
            label={t('schedule.allOccurrences')}
            tone="secondary"
            onPress={() => {
              void onChoose('all').catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'save_failed');
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
    const window = eventWindow(timeZone, dayKey, startMinutes, end);
    const { startsAt, endsAt } = window;
    let recurrence: RecurrenceRule | undefined;
    try {
      recurrence = recurrenceFromForm({
        frequency,
        interval: Number(interval),
        byWeekDay,
        end: repeatEnd,
        timeZone,
        dayKey,
        startMinutes,
      });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'invalid_recurrence');
    }
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
        message={(err) => (err instanceof Error ? err.message : 'create_failed')}
      />
    </View>
  );
};
