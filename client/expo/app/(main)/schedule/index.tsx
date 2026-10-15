/**
 * Month calendar, day list, RSVP, and add-event form.
 */

import { useCalendars } from 'expo-localization';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EVENT_TYPES, RSVP_STATUSES, type EventType, type RecurrenceRule, type RsvpStatus, type ScheduleOccurrence } from '@gameplan/types';
import { EventTimeFields } from '@/src/event-time';
import { RecurrenceFields } from '@/src/recurrence-fields';
import { recurrenceFromForm, type RepeatEnd, type RepeatFrequency } from '@/src/recurrence-form';
import { DEFAULT_START_MINUTES, eventWindow, type EndChoice } from '@/src/event-window';
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
import { Sheet } from '@/src/sheet';
import { useActiveTeam, useApp } from '@/src/state';
import { colors, fieldWash } from '@/src/theme';
import { Button, ErrorText, Field, SubmitButton } from '@/src/ui';

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.prevMonth')}
          className="px-3 py-2"
          onPress={() => setMonth((current) => shiftCalendarMonth(current, -1))}
        >
          <Text className="text-2xl font-semibold text-ink">{'<'}</Text>
        </Pressable>
        <Text className="mx-2 font-semibold text-ink">{monthTitle(month, zone, appLocale)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.nextMonth')}
          className="px-3 py-2"
          onPress={() => setMonth((current) => shiftCalendarMonth(current, 1))}
        >
          <Text className="text-2xl font-semibold text-ink">{'>'}</Text>
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
      {canManage ? <Button label={t('schedule.addEvent')} onPress={() => setAdding(true)} /> : null}
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
            await api.createEvent(team.teamId, body);
            setAdding(false);
            await load(team.teamId, month, zone);
          }}
        />
      </Sheet>
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
  const uses24 = useCalendars()[0].uses24hourClock;
  const hour12 = uses24 === null ? undefined : !uses24;
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
    <View className="mb-3 rounded-xl bg-inset p-3">
      <Text className="font-semibold text-ink">{item.title}</Text>
      <Text className="text-muted">
        {t(`eventType.${item.eventType}`)} · {clockLabel(item.startsAt, zone, appLocale, hour12)}
      </Text>
      {item.location !== undefined ? (
        <Pressable onPress={openMaps}>
          <Text className="text-link">{item.location}</Text>
        </Pressable>
      ) : null}
      <View className="mt-2 flex-row">
        {RSVP_STATUSES.map((status) => (
          <Pressable
            key={status}
            className="mr-2 rounded-full px-3 py-1"
            style={mine === status ? { backgroundColor: fieldWash(rsvpColor(status), 0.28) } : undefined}
            onPress={() => void onRsvp(status)}
          >
            <Text className="text-ink">
              {t(status === 'not_going' ? 'schedule.notGoing' : `schedule.${status}`)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const rsvpColor = (status: RsvpStatus): string => {
  if (status === 'going') return colors.safety;
  if (status === 'not_going') return colors.danger;
  return colors.caution;
};

const AddEvent = ({
  dayKey,
  timeZone,
  onCreate,
}: {
  dayKey: string;
  timeZone: string;
  onCreate: (body: {
    eventType: EventType;
    title: string;
    startsAt: string;
    endsAt?: string;
    location?: string;
    latitude?: number;
    longitude?: number;
    recurrence?: RecurrenceRule;
  }) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [eventType, setEventType] = useState<EventType>('practice');
  const [title, setTitle] = useState('');
  const [startMinutes, setStartMinutes] = useState(DEFAULT_START_MINUTES);
  const [end, setEnd] = useState<EndChoice>({ kind: 'none' });
  const [location, setLocation] = useState('');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ id: string; primaryText: string; secondaryText?: string }>>([]);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | undefined>();
  const [frequency, setFrequency] = useState<RepeatFrequency>('once');
  const [interval, setInterval] = useState('1');
  const [byWeekDay, setByWeekDay] = useState<string[]>(() => [rruleWeekDay(dayKey)]);
  const [repeatEnd, setRepeatEnd] = useState<RepeatEnd>({ kind: 'never' });
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
      ...(endsAt !== undefined ? { endsAt } : {}),
      ...(location.trim().length > 0 ? { location: location.trim() } : {}),
      ...(coords !== undefined ? coords : {}),
      ...(recurrence !== undefined ? { recurrence } : {}),
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
