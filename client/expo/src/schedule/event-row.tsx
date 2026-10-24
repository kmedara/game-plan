/**
 * One occurrence on the selected day. The left stripe is the team's color; the
 * dot and type label use the fixed event-type palette.
 */

import Pencil from 'lucide-react-native/icons/pencil';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RsvpStatus } from '@gameplan/types';
import type { TeamOccurrence } from '@/src/athlete-schedule';
import { appLocale } from '@/src/i18n';
import { clockLabel } from '@/src/schedule-calendar';
import { TrashIcon } from '@/src/team-media';
import { EVENT_TYPE_COLORS } from '@/src/theme';
import { eventLabel } from './event-label';
import { ICON, RsvpChoices, useHour12 } from './rsvp';

export const EventRow = ({
  item,
  zone,
  teamColor,
  teamName,
  userId,
  canManage,
  canDelete,
  onView,
  onEdit,
  onDelete,
  onRsvp,
}: {
  item: TeamOccurrence;
  zone: string;
  teamColor: string;
  teamName: string | undefined;
  userId: string | undefined;
  canManage: boolean;
  canDelete: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRsvp: (status: RsvpStatus) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const hour12 = useHour12();
  const mine = item.rsvps.find((rsvp) => rsvp.userId === userId)?.status;
  const titlePad = canManage ? 'pr-16' : '';
  return (
    <View
      className="mb-3 rounded-xl bg-inset p-3"
      style={{ borderLeftWidth: 4, borderLeftColor: teamColor }}
    >
      <Pressable accessibilityRole="button" onPress={onView}>
        <View className={titlePad}>
          <Text className="text-lg font-semibold text-ink">{eventLabel(t, item)}</Text>
          {teamName !== undefined ? <Text className="text-base text-muted">{teamName}</Text> : null}
          <View className="flex-row items-center">
            <View className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[item.eventType] }} />
            <Text className="text-base font-semibold" style={{ color: EVENT_TYPE_COLORS[item.eventType] }}>
              {t(`eventType.${item.eventType}`)}
            </Text>
            <Text className="text-base text-muted"> · {clockLabel(item.startsAt, zone, appLocale, hour12)}</Text>
          </View>
        </View>
        {item.location !== undefined ? (
          <Text className={`text-base text-link${titlePad ? ` ${titlePad}` : ''}`}>{item.location}</Text>
        ) : null}
      </Pressable>
      <View>
        <RsvpChoices mine={mine} onRsvp={onRsvp} />
      </View>
      {canManage ? (
        <View className="absolute right-2 top-2 flex-row items-center">
          <Pressable accessibilityRole="button" accessibilityLabel={t('schedule.editEvent')} className="p-1.5" onPress={onEdit}>
            <Pencil {...ICON} />
          </Pressable>
          {canDelete ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('schedule.deleteEvent')} className="p-1.5" onPress={onDelete}>
              <TrashIcon />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};
