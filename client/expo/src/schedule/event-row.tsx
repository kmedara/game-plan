/**
 * One occurrence on the selected day, striped in its event type's color.
 */

import Pencil from 'lucide-react-native/icons/pencil';
import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RsvpStatus } from '@gameplan/types';
import type { TeamOccurrence } from '@/src/athlete-schedule';
import { appLocale } from '@/src/i18n';
import { useDownloadUrl } from '@/src/media';
import { clockLabel } from '@/src/schedule-calendar';
import { TrashIcon } from '@/src/team-media';
import { EVENT_TYPE_COLORS } from '@/src/theme';
import { ICON, RsvpChoices, useHour12 } from './rsvp';

export const EventRow = ({
  item,
  zone,
  teamName,
  logoKey,
  logoName,
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
  teamName: string | undefined;
  logoKey: string | undefined;
  logoName: string | undefined;
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
  const logoUrl = useDownloadUrl(logoKey, { teamId: item.teamId });
  const mine = item.rsvps.find((rsvp) => rsvp.userId === userId)?.status;
  const showLogo = logoKey !== undefined;
  return (
    <View
      className="mb-3 rounded-xl bg-inset p-3"
      style={{ borderLeftWidth: 4, borderLeftColor: EVENT_TYPE_COLORS[item.eventType] }}
    >
      <Pressable accessibilityRole="button" onPress={onView}>
        <View className={showLogo ? 'pr-24' : canManage ? 'pr-16' : ''}>
          <Text className="font-semibold text-ink">{item.title}</Text>
          {teamName !== undefined ? <Text className="text-muted">{teamName}</Text> : null}
          <View className="flex-row items-center">
            <View className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: EVENT_TYPE_COLORS[item.eventType] }} />
            <Text className="font-semibold" style={{ color: EVENT_TYPE_COLORS[item.eventType] }}>
              {t(`eventType.${item.eventType}`)}
            </Text>
            <Text className="text-muted"> · {clockLabel(item.startsAt, zone, appLocale, hour12)}</Text>
          </View>
        </View>
        {item.location !== undefined || showLogo ? (
          <View style={{ overflow: 'visible' }}>
            {item.location !== undefined ? (
              <Text className={`text-link${showLogo ? ' pr-24' : ''}`}>{item.location}</Text>
            ) : (
              <View className="h-5" />
            )}
            {showLogo ? (
              <View
                className="absolute right-0 h-20 w-20 items-center justify-center"
                style={{ top: '50%', marginTop: -40 }}
                pointerEvents="none"
              >
                {logoUrl !== undefined ? (
                  <Image
                    source={{ uri: logoUrl }}
                    accessibilityLabel={logoName ?? t('teamAdmin.teamLogo')}
                    contentFit="contain"
                    style={{ width: 80, height: 80 }}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>
      <View className={showLogo ? 'pr-24' : ''}>
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
