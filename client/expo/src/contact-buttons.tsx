/**
 * Call and text buttons for a teammate with a phone number, and a private chat button for everyone.
 */

import MessageCircle from 'lucide-react-native/icons/message-circle';
import MessageSquareText from 'lucide-react-native/icons/message-square-text';
import Phone from 'lucide-react-native/icons/phone';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '@/src/errors';
import { openLink } from '@/src/open-link';
import { createPrivateChatMutation } from '@/src/queries/chat';
import { ICON } from '@/src/schedule/rsvp';
import { useApp } from '@/src/state';

export const ContactButtons = ({
  userId,
  phone,
  onError,
}: {
  userId: string;
  phone: string | undefined;
  onError: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const startChat = useMutation(createPrivateChatMutation(api, queryClient));
  const router = useRouter();
  return (
    <View className="flex-row">
      {phone !== undefined && phone.length > 0 ? (
        <>
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
        </>
      ) : null}
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
    </View>
  );
};
