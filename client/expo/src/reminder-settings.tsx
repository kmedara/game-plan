/**
 * Profile section to pick when event reminders arrive, or turn them off.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { REMINDER_EVENING_HOURS, REMINDER_LEAD_MINUTES, type Preferences } from '@gameplan/types';
import { errorMessageKey } from './errors';
import { appLocale } from './i18n';
import { preferencesQuery, updatePreferencesMutation } from './queries/profile';
import { useApp } from './state';
import { colors } from './theme';
import { ErrorText } from './ui';

/**
 * A local hour as the device's clock shows it, such as `6 PM` or `18:00`.
 *
 * @param hour - Hour, 0-23.
 * @param locale - The app locale.
 * @returns The label.
 */
export const hourLabel = (hour: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, hour)));

const Choice = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => {
  const { brand } = useApp();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      className="mb-2 mr-2 rounded-full border px-3 py-1"
      style={{ borderColor: on ? brand.primary : colors.line, backgroundColor: on ? brand.primary : 'transparent' }}
      onPress={onPress}
    >
      <Text className="text-sm" style={{ color: on ? brand.onPrimary : colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
};

export const ReminderSettings = () => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const loaded = useQuery(preferencesQuery(api));
  const save = useMutation(updatePreferencesMutation(api, queryClient));
  const [error, setError] = useState<string | undefined>();
  const prefs = loaded.data;
  if (prefs === undefined) return null;

  const set = (changes: Partial<Preferences>): void => {
    setError(undefined);
    save.mutate(changes, { onError: (err) => setError(t(errorMessageKey(err, 'errors.common.saveFailed'))) });
  };
  const evening = save.variables?.reminderEveningHour !== undefined && save.isPending
    ? save.variables.reminderEveningHour
    : prefs.reminderEveningHour;
  const lead = save.variables?.reminderLeadMinutes !== undefined && save.isPending
    ? save.variables.reminderLeadMinutes
    : prefs.reminderLeadMinutes;

  return (
    <View className="mb-2 mt-4">
      <Text className="mb-1 text-lg font-semibold text-ink">{t('reminders.title')}</Text>
      <Text className="mb-2 text-muted">{t('reminders.hint')}</Text>
      <ErrorText message={error} />
      <Text className="mb-1 text-sm text-muted">{t('reminders.eveningBefore')}</Text>
      <View className="flex-row flex-wrap">
        <Choice label={t('reminders.off')} on={evening === null} onPress={() => set({ reminderEveningHour: null })} />
        {REMINDER_EVENING_HOURS.map((hour) => (
          <Choice
            key={hour}
            label={hourLabel(hour, appLocale)}
            on={evening === hour}
            onPress={() => set({ reminderEveningHour: hour })}
          />
        ))}
      </View>
      <Text className="mb-1 mt-1 text-sm text-muted">{t('reminders.beforeStart')}</Text>
      <View className="flex-row flex-wrap">
        <Choice label={t('reminders.off')} on={lead === null} onPress={() => set({ reminderLeadMinutes: null })} />
        {REMINDER_LEAD_MINUTES.map((minutes) => (
          <Choice
            key={minutes}
            label={minutes < 60 ? t('reminders.minutes', { count: minutes }) : t('reminders.hours', { count: minutes / 60 })}
            on={lead === minutes}
            onPress={() => set({ reminderLeadMinutes: minutes })}
          />
        ))}
      </View>
    </View>
  );
};
