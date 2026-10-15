/**
 * Start clock, duration chips, and an optional custom end for the add-event form.
 */

import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useCalendars } from 'expo-localization';
import { useTranslation } from 'react-i18next';
import { appLocale } from './i18n';
import { DURATION_PRESETS, eventWindow, type EndChoice } from './event-window';
import { clockLabel } from './schedule-calendar';
import { useApp } from './state';
import { TimeClock } from './time-clock';

export const EventTimeFields = ({
  dayKey,
  timeZone,
  startMinutes,
  end,
  onChangeStart,
  onChangeEnd,
}: {
  dayKey: string;
  timeZone: string;
  startMinutes: number;
  end: EndChoice;
  onChangeStart: (minutes: number) => void;
  onChangeEnd: (end: EndChoice) => void;
}) => {
  const { t } = useTranslation();
  const uses24 = useCalendars()[0].uses24hourClock;
  const hour12 = uses24 === null ? undefined : !uses24;
  const [open, setOpen] = useState<'start' | 'end' | undefined>(Platform.OS === 'web' ? 'start' : undefined);
  const window = eventWindow(timeZone, dayKey, startMinutes, end);
  const startLabel = clockLabel(window.startsAt, timeZone, appLocale, hour12);
  const customMinutes = end.kind === 'clock' ? end.minutes : (startMinutes + 90) % 1440;

  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-muted">{t('addEvent.start')}</Text>
      {Platform.OS === 'web' ? (
        <TimeClock minutes={startMinutes} onChange={onChangeStart} />
      ) : (
        <Pressable
          className="rounded-xl border border-line bg-inset px-3 py-2"
          onPress={() => setOpen((current) => (current === 'start' ? undefined : 'start'))}
        >
          <Text className="text-base text-ink">{startLabel}</Text>
        </Pressable>
      )}
      {open === 'start' && Platform.OS !== 'web' ? (
        <TimeClock
          minutes={startMinutes}
          onChange={onChangeStart}
          onDismiss={() => setOpen(undefined)}
        />
      ) : null}
      <Text className="mb-1 mt-3 text-sm text-muted">{t('addEvent.end')}</Text>
      <View className="flex-row flex-wrap">
        <Chip label={t('addEvent.noEnd')} selected={end.kind === 'none'} onPress={() => onChangeEnd({ kind: 'none' })} />
        {DURATION_PRESETS.map((minutes) => (
          <Chip
            key={minutes}
            label={t('addEvent.spanMinutes', { count: minutes })}
            selected={end.kind === 'minutes' && end.minutes === minutes}
            onPress={() => onChangeEnd({ kind: 'minutes', minutes })}
          />
        ))}
        <Chip
          label={t('addEvent.custom')}
          selected={end.kind === 'clock'}
          onPress={() => {
            onChangeEnd({ kind: 'clock', minutes: customMinutes });
            setOpen('end');
          }}
        />
      </View>
      {end.kind === 'clock' && (Platform.OS === 'web' || open === 'end') ? (
        <View className="mt-2">
          <TimeClock
            minutes={end.minutes}
            onChange={(minutes) => onChangeEnd({ kind: 'clock', minutes })}
            onDismiss={() => setOpen(undefined)}
          />
        </View>
      ) : null}
      {window.endsAt !== undefined && window.durationMinutes !== undefined ? (
        <Text className="mt-2 text-muted">
          {t('addEvent.span', {
            start: startLabel,
            end: clockLabel(window.endsAt, timeZone, appLocale, hour12),
            minutes: window.durationMinutes,
          })}
          {window.nextDay ? ` · ${t('addEvent.nextDay')}` : ''}
        </Text>
      ) : null}
    </View>
  );
};

const Chip = ({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) => {
  const { brand } = useApp();
  return (
    <Pressable
      className={`mb-2 mr-2 rounded-full border px-3 py-1 ${selected ? '' : 'border-line bg-paper'}`}
      style={selected ? { backgroundColor: brand.primary, borderColor: brand.primary } : undefined}
      onPress={onPress}
    >
      <Text className={selected ? 'font-semibold' : 'text-ink'} style={selected ? { color: brand.onPrimary } : undefined}>{label}</Text>
    </Pressable>
  );
};
