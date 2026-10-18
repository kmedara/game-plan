/**
 * RSVP chips shared by the day row and the event detail.
 */

import { useCalendars } from 'expo-localization';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RSVP_STATUSES, type RsvpStatus } from '@gameplan/types';
import { colors, fieldWash, fieldWashOpacity } from '@/src/theme';

/** Row-action icon size and stroke. */
export const ICON = { size: 16, color: colors.ink, strokeWidth: 2 } as const;

/** Translation key for an RSVP status. */
export const rsvpLabelKey = (status: RsvpStatus): string =>
  status === 'not_going' ? 'schedule.notGoing' : `schedule.${status}`;

/** The device's 12/24-hour preference, or `undefined` to use the locale default. */
export const useHour12 = (): boolean | undefined => {
  const uses24 = useCalendars()[0].uses24hourClock;
  return uses24 === null ? undefined : !uses24;
};

export const rsvpColor = (status: RsvpStatus): string => {
  if (status === 'going') return colors.safety;
  if (status === 'not_going') return colors.danger;
  return colors.caution;
};

export const RsvpChoices = ({
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
