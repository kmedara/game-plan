/**
 * One person on the attendance list, with call, text, or a private chat.
 */

import MessageCircle from 'lucide-react-native/icons/message-circle';
import MessageSquareText from 'lucide-react-native/icons/message-square-text';
import Phone from 'lucide-react-native/icons/phone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamMember } from '@gameplan/types';
import { errorMessageKey } from '@/src/errors';
import { useDownloadUrl } from '@/src/media';
import { openLink } from '@/src/open-link';
import { createPrivateChatMutation } from '@/src/queries/chat';
import { useApp } from '@/src/state';
import { ProfilePhoto } from '@/src/ui';
import { ICON } from './rsvp';

export const AttendanceRow = ({
  userId,
  name,
  member,
  self,
  onError,
}: {
  userId: string;
  name: string;
  member: TeamMember | undefined;
  self: boolean;
  onError: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const startChat = useMutation(createPrivateChatMutation(api, queryClient));
  const router = useRouter();
  const photo = useDownloadUrl(member?.photoKey, { userId });
  const phone = member?.phoneNumber;
  return (
    <View className="mb-2 flex-row items-center">
      <ProfilePhoto name={name} uri={photo} size={36} />
      <Text className="ml-3 flex-1 text-ink">{name}</Text>
      {!self && phone !== undefined && phone.length > 0 ? (
        <View className="flex-row">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('schedule.call')}
            className="p-1.5"
            onPress={() => void openLink(`tel:${phone}`)}
          >
            <Phone {...ICON} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('schedule.text')}
            className="p-1.5"
            onPress={() => void openLink(`sms:${phone}`)}
          >
            <MessageSquareText {...ICON} />
          </Pressable>
        </View>
      ) : null}
      {!self && (phone === undefined || phone.length === 0) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.message')}
          className="p-1.5"
          onPress={() => {
            void startChat
              .mutateAsync({ memberIds: [userId] })
              .then((chat) => router.push(`/chats/${chat.chatId}`))
              .catch((err: unknown) => onError(t(errorMessageKey(err, 'errors.event.messageFailed'))));
          }}
        >
          <MessageCircle {...ICON} />
        </Pressable>
      ) : null}
    </View>
  );
};
