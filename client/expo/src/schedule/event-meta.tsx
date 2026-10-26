/**
 * The "● Type · time · team" line under an event's name. Separators carry
 * their own margins rather than relying on spaces in the text, which React
 * Native can drop at the start of a text run. The type and time never wrap;
 * only the team name gives way on a narrow screen.
 */

import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { EventType } from '@gameplan/types';
import { EVENT_TYPE_COLORS } from '@/src/theme';

const Separator = () => <Text className="mx-1.5 shrink-0 text-base text-muted">·</Text>;

/**
 * @param eventType - Picks the dot color and type label.
 * @param time - The formatted start time.
 * @param teamName - Shown last, and cut short first, when set.
 */
export const EventMeta = ({ eventType, time, teamName }: { eventType: EventType; time: string; teamName: string | undefined }) => {
  const { t } = useTranslation();
  const color = EVENT_TYPE_COLORS[eventType];
  return (
    <View className="flex-row items-center">
      <View className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <Text className="shrink-0 text-base font-semibold" style={{ color }} numberOfLines={1}>
        {t(`eventType.${eventType}`)}
      </Text>
      <Separator />
      <Text className="shrink-0 text-base text-muted" numberOfLines={1}>
        {time}
      </Text>
      {teamName !== undefined ? (
        <>
          <Separator />
          <Text className="shrink text-base text-muted" numberOfLines={1}>
            {teamName}
          </Text>
        </>
      ) : null}
    </View>
  );
};
