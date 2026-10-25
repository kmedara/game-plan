/**
 * One occurrence on the selected day. The left stripe is the team's color; the
 * dot and type label use the fixed event-type palette. The name line is left
 * out for events without one, and the team name trails the time so it is the
 * part cut short on narrow screens.
 */

import Pencil from 'lucide-react-native/icons/pencil';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RsvpStatus } from '@gameplan/types';
import type { TeamOccurrence } from '@/src/athlete-schedule';
import { appLocale } from '@/src/i18n';
import { clockLabel } from '@/src/schedule-calendar';
import { TrashIcon } from '@/src/team-media';
import { eventLabel } from './event-label';
import { EventMeta } from './event-meta';
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
  const typeLabel = t(`eventType.${item.eventType}`);
  // Practices and bare games have no name of their own, so the type line says it all.
  const label = eventLabel(t, item);
  const title = label === typeLabel ? undefined : label;
  return (
    <View
      className="mb-3 rounded-xl bg-inset p-3"
      style={{ borderLeftWidth: 4, borderLeftColor: teamColor }}
    >
      <Pressable accessibilityRole="button" onPress={onView}>
        <View className={titlePad}>
          {title !== undefined ? <Text className="text-lg font-semibold text-ink">{title}</Text> : null}
          <EventMeta
            eventType={item.eventType}
            time={clockLabel(item.startsAt, zone, appLocale, hour12)}
            teamName={teamName}
          />
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
