/**
 * Repeat controls for a new event: frequency, interval, weekdays, and end.
 */

import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DayField } from './day-field';
import type { RepeatEnd, RepeatFrequency } from './recurrence-form';
import { RRULE_WEEKDAYS, weekdayLabelsForLocale } from './schedule-calendar';
import { appLocale } from './i18n';
import { useApp } from './state';

const FREQUENCIES: readonly RepeatFrequency[] = ['once', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

const frequencyKey = (frequency: RepeatFrequency): string => {
  if (frequency === 'once') return 'addEvent.once';
  if (frequency === 'DAILY') return 'addEvent.daily';
  if (frequency === 'WEEKLY') return 'addEvent.weekly';
  if (frequency === 'MONTHLY') return 'addEvent.monthly';
  return 'addEvent.yearly';
};

const unitKey = (frequency: RepeatFrequency): string => {
  if (frequency === 'DAILY') return 'addEvent.days';
  if (frequency === 'WEEKLY') return 'addEvent.weeks';
  if (frequency === 'MONTHLY') return 'addEvent.months';
  return 'addEvent.years';
};

export const RecurrenceFields = ({
  frequency,
  interval,
  byWeekDay,
  end,
  onChangeFrequency,
  onChangeInterval,
  onChangeWeekDays,
  onChangeEnd,
}: {
  frequency: RepeatFrequency;
  interval: string;
  byWeekDay: readonly string[];
  end: RepeatEnd;
  onChangeFrequency: (frequency: RepeatFrequency) => void;
  onChangeInterval: (interval: string) => void;
  onChangeWeekDays: (days: string[]) => void;
  onChangeEnd: (end: RepeatEnd) => void;
}) => {
  const { t } = useTranslation();
  const { brand } = useApp();
  const labels = weekdayLabelsForLocale(appLocale);
  return (
    <View className="mb-3">
      <Text className="mb-1 text-sm text-muted">{t('addEvent.frequency')}</Text>
      <View className="mb-2 flex-row flex-wrap">
        {FREQUENCIES.map((option) => (
          <Pressable key={option} className="mb-2 mr-3" onPress={() => onChangeFrequency(option)}>
            <Text className={frequency === option ? 'font-bold' : 'text-ink'} style={frequency === option ? { color: brand.secondary } : undefined}>
              {t(frequencyKey(option))}
            </Text>
          </Pressable>
        ))}
      </View>
      {frequency === 'once' ? null : (
        <>
          <Text className="mb-1 text-sm text-muted">{t('addEvent.every')}</Text>
          <View className="mb-3 flex-row items-center">
            <TextInput
              className="mr-2 w-16 rounded-xl border border-line bg-inset px-3 py-2 text-base text-ink"
              value={interval}
              onChangeText={onChangeInterval}
              keyboardType="number-pad"
            />
            <Text className="text-ink">{t(unitKey(frequency))}</Text>
          </View>
          {frequency === 'WEEKLY' ? (
            <View className="mb-3 flex-row flex-wrap">
              {RRULE_WEEKDAYS.map((code, index) => {
                const selected = byWeekDay.includes(code);
                return (
                  <Pressable
                    key={code}
                    className={`mb-2 mr-2 rounded-full border px-3 py-1 ${selected ? '' : 'border-line bg-paper'}`}
                    style={selected ? { backgroundColor: brand.primary, borderColor: brand.primary } : undefined}
                    onPress={() => {
                      if (selected && byWeekDay.length === 1) return;
                      onChangeWeekDays(
                        selected ? byWeekDay.filter((day) => day !== code) : [...byWeekDay, code],
                      );
                    }}
                  >
                    <Text className={selected ? 'font-semibold' : 'text-ink'} style={selected ? { color: brand.onPrimary } : undefined}>
                      {labels[index]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Text className="mb-1 text-sm text-muted">{t('addEvent.ends')}</Text>
          <View className="mb-2 flex-row flex-wrap">
            <Pressable className="mr-3" onPress={() => onChangeEnd({ kind: 'never' })}>
              <Text className={end.kind === 'never' ? 'font-bold' : 'text-ink'} style={end.kind === 'never' ? { color: brand.secondary } : undefined}>
                {t('addEvent.endsNever')}
              </Text>
            </Pressable>
            <Pressable className="mr-3" onPress={() => onChangeEnd({ kind: 'until', dayKey: end.kind === 'until' ? end.dayKey : '' })}>
              <Text className={end.kind === 'until' ? 'font-bold' : 'text-ink'} style={end.kind === 'until' ? { color: brand.secondary } : undefined}>
                {t('addEvent.endsOn')}
              </Text>
            </Pressable>
            <Pressable onPress={() => onChangeEnd({ kind: 'count', count: end.kind === 'count' ? end.count : 10 })}>
              <Text className={end.kind === 'count' ? 'font-bold' : 'text-ink'} style={end.kind === 'count' ? { color: brand.secondary } : undefined}>
                {t('addEvent.endsAfter')}
              </Text>
            </Pressable>
          </View>
          {end.kind === 'until' ? (
            <View className="mb-2">
              <DayField value={end.dayKey} onChange={(dayKey) => onChangeEnd({ kind: 'until', dayKey })} />
            </View>
          ) : null}
          {end.kind === 'count' ? (
            <View className="mb-2 flex-row items-center">
              <TextInput
                className="mr-2 w-16 rounded-xl border border-line bg-inset px-3 py-2 text-base text-ink"
                value={String(end.count)}
                onChangeText={(value) => onChangeEnd({ kind: 'count', count: Number(value.replace(/\D/g, '')) || 0 })}
                keyboardType="number-pad"
              />
              <Text className="text-ink">{t('addEvent.times')}</Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
};
