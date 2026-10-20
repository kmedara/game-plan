/**
 * Profile section that subscribes Google, Apple, or Outlook Calendar to the
 * person's private GamePlan feed.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { subscribeUrl, type CalendarApp } from './calendar-links';
import { errorMessageKey, queryError } from './errors';
import { queryKeys } from './queries/keys';
import { useApp } from './state';
import { Button, ErrorText, SubmitButton } from './ui';

const APPS: readonly { app: CalendarApp; label: string }[] = [
  { app: 'google', label: 'Google Calendar' },
  { app: 'apple', label: 'Apple Calendar' },
  { app: 'outlook', label: 'Outlook' },
];

export const CalendarSync = () => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  // The link is created on first request, so wait until the person asks for it.
  const [open, setOpen] = useState(false);
  const feed = useQuery({ queryKey: queryKeys.calendarFeed, queryFn: () => api.getCalendarFeed(), enabled: open });
  const rotate = useMutation({
    mutationFn: () => api.rotateCalendarFeed(),
    onSuccess: (next) => queryClient.setQueryData(queryKeys.calendarFeed, next),
  });
  const [error, setError] = useState<string | undefined>();
  const loadError = queryError(feed.error);

  return (
    <View className="mb-2 mt-4">
      <Text className="mb-1 text-lg font-semibold text-ink">{t('calendarSync.title')}</Text>
      <Text className="mb-2 text-muted">{t('calendarSync.hint')}</Text>
      <ErrorText message={error ?? (loadError === undefined ? undefined : t(errorMessageKey(loadError, 'errors.common.loadFailed')))} />
      {!open ? (
        <Button label={t('calendarSync.show')} tone="secondary" onPress={() => setOpen(true)} />
      ) : feed.data === undefined ? (
        <Text className="text-muted">{t('common.loading')}</Text>
      ) : (
        <>
          {APPS.map(({ app, label }) => (
            <Button
              key={app}
              label={t('calendarSync.addTo', { app: label })}
              tone="secondary"
              onPress={() => {
                setError(undefined);
                void Linking.openURL(subscribeUrl(app, feed.data)).catch(() => setError(t('calendarSync.openFailed')));
              }}
            />
          ))}
          <SubmitButton
            label={t('common.copyLink')}
            tone="secondary"
            loadedText={t('common.copied')}
            onPress={() => Clipboard.setStringAsync(feed.data.url).then(() => undefined)}
          />
          <Text className="mb-2 text-sm text-muted">{t('calendarSync.refreshNote')}</Text>
          <SubmitButton
            label={t('calendarSync.reset')}
            tone="danger"
            loadedText={t('calendarSync.resetDone')}
            message={(err) => t(errorMessageKey(err, 'errors.common.requestFailed'))}
            onPress={async () => {
              await rotate.mutateAsync();
            }}
          />
        </>
      )}
    </View>
  );
};
