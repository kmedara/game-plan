/**
 * Banner that offers notifications when this device has no choice recorded yet.
 *
 * The system prompt only appears after a tap on "Turn on": iPhone Safari
 * ignores a prompt that does not come from a tap, and iOS shows its own dialog
 * just once, so the banner explains why first. "Not now" hides it for a week.
 */

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { readPreference, writePreference } from './refresh-store';
import { loadPushStatus, registerPush, type PushStatus } from './push';
import { useApp } from './state';
import { Button } from './ui';

/** Device storage key for when the banner may show again. */
export const NOTIFICATION_PROMPT_KEY = 'notification-prompt-snoozed-until';

/** How long "Not now" hides the banner. */
export const NOTIFICATION_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether to offer notifications.
 *
 * @param status - This device's notification status.
 * @param snoozedUntil - Stored epoch milliseconds from "Not now", if any.
 * @param now - The current time in epoch milliseconds.
 * @returns `true` when no choice is recorded (or the site must be installed first) and no snooze applies.
 */
export const shouldOfferNotifications = (
  status: PushStatus,
  snoozedUntil: string | undefined,
  now: number,
): boolean => {
  if (status !== 'prompt' && status !== 'needs-install') return false;
  const until = Number(snoozedUntil);
  return !(Number.isFinite(until) && until > now);
};

export const NotificationPrompt = () => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [status, setStatus] = useState<PushStatus | undefined>();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([loadPushStatus(), readPreference(NOTIFICATION_PROMPT_KEY, api.native)]).then(
      ([current, snoozedUntil]) => {
        if (!live) return;
        setStatus(current);
        setVisible(shouldOfferNotifications(current, snoozedUntil, Date.now()));
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!visible || status === undefined) return null;

  const snooze = (): void => {
    setVisible(false);
    void writePreference(NOTIFICATION_PROMPT_KEY, String(Date.now() + NOTIFICATION_SNOOZE_MS), api.native);
  };

  const turnOn = (): void => {
    // `registerPush` asks before awaiting anything else, which Safari requires.
    void registerPush(api).then((next) => {
      setStatus(next);
      if (next !== 'prompt') setVisible(false);
    });
  };

  return (
    <View className="mx-4 mt-3 rounded-xl border border-line bg-raised p-3">
      <Text className="mb-1 font-semibold text-ink">{t('notificationPrompt.title')}</Text>
      {status === 'needs-install' ? (
        <>
          <Text className="mb-2 text-muted">{t('profile.notificationsNeedInstall')}</Text>
          <Button label={t('notificationPrompt.gotIt')} tone="secondary" onPress={snooze} />
        </>
      ) : (
        <>
          <Text className="mb-2 text-muted">{t('notificationPrompt.body')}</Text>
          <Button label={t('profile.turnOnNotifications')} onPress={turnOn} />
          <Button label={t('notificationPrompt.notNow')} tone="secondary" onPress={snooze} />
        </>
      )}
    </View>
  );
};
