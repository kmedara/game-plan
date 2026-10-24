/**
 * Create and edit form for a practice or game.
 */

import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, EVENT_TYPE_COLORS } from '@/src/theme';
import { useTranslation } from 'react-i18next';
import {
  EVENT_TYPES,
  type EventResponse,
  type EventType,
  type GameSide,
  type RecurrenceRule,
  type ScheduleOccurrence,
  type UpdateEventBody,
} from '@gameplan/types';
import { EventTimeFields } from '@/src/event-time';
import { DEFAULT_START_MINUTES, DURATION_PRESETS, eventWindow, type EndChoice } from '@/src/event-window';
import { errorMessageKey } from '@/src/errors';
import { MapPicker } from '@/src/map-picker';
import { RecurrenceFields } from '@/src/recurrence-fields';
import { recurrenceFromForm, type RepeatEnd, type RepeatFrequency } from '@/src/recurrence-form';
import { dayKeyInZone, minutesInZone, rruleWeekDay } from '@/src/schedule-calendar';
import { useApp } from '@/src/state';
import { Chip, EqualChipRow, Field, SubmitButton } from '@/src/ui';

/** What the form says when it refuses to save. */
const FORM_ERRORS = {
  side_required: 'errors.event.chooseSide',
  opponent_required: 'errors.event.opponentRequired',
  title_required: 'errors.event.titleRequired',
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

export const AddEvent = ({
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

  const named = eventType === 'meeting' || eventType === 'other';

  const submit = async (): Promise<boolean | void> => {
    // Say what is missing instead of silently not saving.
    if (named && title.trim().length === 0) throw new Error('title_required');
    if (eventType === 'game' && side === undefined) throw new Error('side_required');
    if (eventType === 'game' && opponentName.trim().length === 0) throw new Error('opponent_required');
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
      // Practices and games are named by the server from their type, side, and opponent.
      ...(named ? { title: title.trim() } : {}),
      startsAt,
      endsAt: endsAt ?? null,
      location: location.trim().length > 0 ? location.trim() : null,
      notes: notes.trim().length > 0 ? notes.trim() : null,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      recurrence: recurrence ?? null,
      ...(eventType === 'game'
        ? {
            opponentName: opponentName.trim(),
            side: side ?? null,
          }
        : { opponentName: null, side: null }),
    });
  };

  return (
    <View className="mb-8">
      <View className="mb-2 flex-row flex-wrap">
        {EVENT_TYPES.map((type) => (
          <Pressable
            key={type}
            accessibilityRole="radio"
            accessibilityState={{ selected: eventType === type }}
            className="mb-2 mr-2 flex-row items-center rounded-full border px-3 py-1"
            style={{ borderColor: eventType === type ? EVENT_TYPE_COLORS[type] : colors.line }}
            onPress={() => setEventType(type)}
          >
            <View className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[type] }} />
            <Text
              className={eventType === type ? 'font-bold' : 'text-ink'}
              style={eventType === type ? { color: EVENT_TYPE_COLORS[type] } : undefined}
            >
              {t(`eventType.${type}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      {named ? <Field label={t('addEvent.title')} value={title} onChangeText={setTitle} /> : null}
      {eventType === 'game' ? (
        <>
          <Field label={t('schedule.opponent')} value={opponentName} onChangeText={setOpponentName} />
          <EqualChipRow className="mb-3">
            {(['home', 'away'] as const).map((choice) => (
              <Chip
                key={choice}
                equal
                label={t(`schedule.${choice}`)}
                selected={side === choice}
                onPress={() => setSide(choice)}
              />
            ))}
          </EqualChipRow>
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
        message={(err) => t(errorMessageKey(err, 'errors.common.saveFailed', FORM_ERRORS))}
      />
    </View>
  );
};
