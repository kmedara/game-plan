/**
 * Month calendar, day list, RSVP, and add-event form.
 */

import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { eventWindowIsValid } from '@gameplan/rules';
import { EVENT_TYPES, RSVP_STATUSES, type EventType, type RsvpStatus, type ScheduleOccurrence } from '@gameplan/types';
import { appLocale } from '@/src/i18n';
import { MapPicker } from '@/src/map-picker';
import { mapsUrl, type MapsProvider } from '@/src/maps';
import {
  buildMonthGrid,
  clockLabel,
  dayKeyInZone,
  dayTitle,
  monthTitle,
  rruleWeekDay,
  shiftCalendarMonth,
  wallTimeToIso,
  weekdayLabelsForLocale,
  type CalendarMonth,
} from '@/src/schedule-calendar';
import { useActiveTeam, useApp } from '@/src/state';
import { Button, ErrorText, Field } from '@/src/ui';

const monthRange = (month: CalendarMonth, timeZone: string): { from: string; to: string } => {
  const cells = buildMonthGrid(month.year, month.month, timeZone);
  const first = cells[0]?.key ?? `${month.year}-01-01`;
  const last = cells.at(-1)?.key ?? first;
  return { from: wallTimeToIso(timeZone, first, '00:00'), to: wallTimeToIso(timeZone, last, '23:59') };
};

export default function ScheduleScreen() {
  const { t } = useTranslation();
  const { api, live } = useApp();
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
        const mine = permissions.roles.find((row) => row.role === team.role);
        setCanManage(mine?.permissions.includes('manage_events') ?? false);
      })
      .catch(() => setCanManage(false));
  }, [team?.teamId, month.year, month.month]);

  useEffect(() => {
    return live.subscribe((event) => {
      if (event.type === 'schedule_changed' && event.teamId === team?.teamId) {
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
        <Button label={t('schedule.prevMonth')} onPress={() => setMonth((current) => shiftCalendarMonth(current, -1))} />
        <Text className="mx-2 font-semibold">{monthTitle(month, zone, appLocale)}</Text>
        <Button label={t('schedule.nextMonth')} onPress={() => setMonth((current) => shiftCalendarMonth(current, 1))} />
      </View>
      <View className="mb-2 flex-row">
        {weekdayLabelsForLocale(appLocale).map((label) => (
          <Text key={label} className="flex-1 text-center text-xs text-slate-500">
            {label}
          </Text>
        ))}
      </View>
      <View className="mb-4 flex-row flex-wrap">
        {cells.map((cell) => {
          const has = events.some((item) => dayKeyInZone(new Date(item.startsAt), zone) === cell.key);
          return (
            <Pressable key={cell.key} className="w-[14.28%] items-center py-2" onPress={() => setSelected(cell.key)}>
              <Text className={cell.key === selected ? 'font-bold text-teal-800' : cell.inMonth ? 'text-slate-900' : 'text-slate-400'}>
                {cell.day}
                {has ? ' •' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="mb-2 text-lg font-semibold">{dayTitle(selected, zone, appLocale)}</Text>
      {dayEvents.length === 0 ? <Text className="mb-3 text-slate-500">{t('schedule.nothingScheduled')}</Text> : null}
      {dayEvents.map((item) => (
        <EventRow
          key={`${item.eventId}-${item.startsAt}`}
          item={item}
          zone={zone}
          userId={api.user?.userId}
          maps={primaryMaps}
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
      {canManage ? (
        adding ? (
          <AddEvent
            dayKey={selected}
            timeZone={zone}
            onCancel={() => setAdding(false)}
            onCreate={async (body) => {
              await api.createEvent(team.teamId, body);
              setAdding(false);
              await load(team.teamId, month, zone);
            }}
          />
        ) : (
          <Button label={t('schedule.addEvent')} onPress={() => setAdding(true)} />
        )
      ) : null}
    </ScrollView>
  );
}

const EventRow = ({
  item,
  zone,
  userId,
  maps,
  onRsvp,
}: {
  item: ScheduleOccurrence;
  zone: string;
  userId: string | undefined;
  maps: MapsProvider;
  onRsvp: (status: RsvpStatus) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const mine = item.rsvps.find((rsvp) => rsvp.userId === userId)?.status;
  const openMaps = (): void => {
    if (item.location === undefined && item.latitude === undefined) return;
    const url = mapsUrl(
      { label: item.location ?? 'Event', latitude: item.latitude, longitude: item.longitude },
      maps,
    );
    void WebBrowser.openBrowserAsync(url);
  };
  return (
    <View className="mb-3 rounded-lg bg-white p-3">
      <Text className="font-semibold">{item.title}</Text>
      <Text className="text-slate-600">
        {t(`eventType.${item.eventType}`)} · {clockLabel(item.startsAt, zone, appLocale)}
      </Text>
      {item.location !== undefined ? (
        <Pressable onPress={openMaps}>
          <Text className="text-teal-800">{item.location}</Text>
        </Pressable>
      ) : null}
      <View className="mt-2 flex-row">
        {RSVP_STATUSES.map((status) => (
          <Pressable key={status} className="mr-3" onPress={() => void onRsvp(status)}>
            <Text className={mine === status ? 'font-bold text-teal-800' : 'text-slate-700'}>
              {t(status === 'not_going' ? 'schedule.notGoing' : `schedule.${status}`)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const AddEvent = ({
  dayKey,
  timeZone,
  onCancel,
  onCreate,
}: {
  dayKey: string;
  timeZone: string;
  onCancel: () => void;
  onCreate: (body: {
    eventType: EventType;
    title: string;
    startsAt: string;
    endsAt?: string;
    location?: string;
    latitude?: number;
    longitude?: number;
    recurrence?: { frequency: 'WEEKLY'; interval: number; byWeekDay: string[] };
  }) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [eventType, setEventType] = useState<EventType>('practice');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ id: string; primaryText: string; secondaryText?: string }>>([]);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | undefined>();
  const [weekly, setWeekly] = useState(false);
  const [error, setError] = useState<string | undefined>();

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

  const submit = async (): Promise<void> => {
    if (title.trim().length === 0) return;
    const startsAt = wallTimeToIso(timeZone, dayKey, start);
    const endsAt = end.length > 0 ? wallTimeToIso(timeZone, dayKey, end) : undefined;
    if (!eventWindowIsValid(startsAt, endsAt)) {
      setError('invalid_ends_at');
      return;
    }
    setError(undefined);
    try {
      await onCreate({
        eventType,
        title: title.trim(),
        startsAt,
        ...(endsAt !== undefined ? { endsAt } : {}),
        ...(location.trim().length > 0 ? { location: location.trim() } : {}),
        ...(coords !== undefined ? coords : {}),
        ...(weekly ? { recurrence: { frequency: 'WEEKLY' as const, interval: 1, byWeekDay: [rruleWeekDay(dayKey)] } } : {}),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create_failed');
    }
  };

  return (
    <View className="mb-8">
      <ErrorText message={error} />
      <View className="mb-2 flex-row flex-wrap">
        {EVENT_TYPES.map((type) => (
          <Pressable key={type} className="mr-3" onPress={() => setEventType(type)}>
            <Text className={eventType === type ? 'font-bold' : ''}>{t(`eventType.${type}`)}</Text>
          </Pressable>
        ))}
      </View>
      <Field label={t('addEvent.title')} value={title} onChangeText={setTitle} />
      <Field label={t('addEvent.start')} value={start} onChangeText={setStart} placeholder="HH:mm" />
      <Field label={t('addEvent.end')} value={end} onChangeText={setEnd} placeholder="HH:mm" />
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
      <Pressable className="mb-3" onPress={() => setWeekly((value) => !value)}>
        <Text>{weekly ? '☑' : '☐'} {t('addEvent.weekly')}</Text>
      </Pressable>
      <Button label={t('common.save')} onPress={() => void submit()} />
      <Button label={t('common.cancel')} onPress={onCancel} color="#64748b" />
    </View>
  );
};
