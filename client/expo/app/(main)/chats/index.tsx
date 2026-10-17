/**
 * Chat list for the active team plus private chats.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChatSummary } from '@gameplan/types';
import { errorMessageKey } from '@/src/errors';
import { chatsQuery, createPrivateChatMutation, createTeamChannelMutation } from '@/src/queries/chat';
import { useApp } from '@/src/state';
import { ErrorText, Field, SubmitButton } from '@/src/ui';

export default function ChatsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();
  const mode = action === 'private' || action === 'channel' ? action : undefined;
  const { api } = useApp();
  const queryClient = useQueryClient();
  const teamId = api.selectedTeamId;
  const chatsLoaded = useQuery(chatsQuery(api));
  const startPrivateChat = useMutation(createPrivateChatMutation(api, queryClient));
  const startChannelChat = useMutation(createTeamChannelMutation(api, queryClient));
  const chats = chatsLoaded.data ?? [];
  const [email, setEmail] = useState('');
  const [channelName, setChannelName] = useState('');
  const error =
    chatsLoaded.error !== undefined ? t(errorMessageKey(chatsLoaded.error, 'errors.common.loadFailed')) : undefined;

  const startPrivate = async (): Promise<void> => {
    const user = await api.searchChatUser(email);
    if (user.userId === api.user?.userId) throw new Error('self');
    const chat = await startPrivateChat.mutateAsync([user.userId]);
    router.push(`/chats/${chat.chatId}`);
  };

  const startChannel = async (): Promise<void> => {
    if (teamId === undefined || channelName.trim().length === 0) throw new Error('name');
    const chat = await startChannelChat.mutateAsync({ teamId, name: channelName.trim() });
    router.push(`/chats/${chat.chatId}`);
  };

  const teamChats = chats.filter((chat) => chat.kind === 'default' && chat.teamId === teamId);
  const channels = chats.filter((chat) => chat.kind === 'channel' && chat.teamId === teamId);
  const privateChats = chats.filter((chat) => chat.kind === 'private');

  return (
    <ScrollView className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      <Text className="mb-3 text-muted">{t('chats.hint')}</Text>
      {mode === 'private' ? (
        <View className="mb-4">
          <Field label={t('chats.email')} value={email} onChangeText={setEmail} />
          <SubmitButton
            label={t('chats.startPrivate')}
            onPress={startPrivate}
            message={(err) =>
              t(errorMessageKey(err, 'chats.searchFailed', { self: 'chats.cannotChatSelf', not_found: 'chats.userNotFound' }))
            }
          />
        </View>
      ) : null}
      {mode === 'channel' ? (
        <View className="mb-4">
          <Field label={t('chats.channelName')} value={channelName} onChangeText={setChannelName} />
          <SubmitButton
            label={t('chats.createChannel')}
            onPress={startChannel}
            message={(err) => t(errorMessageKey(err, 'chats.createFailed', { name: 'chats.channelNameRequired' }))}
          />
        </View>
      ) : null}
      <ChatGroup title={t('chats.team')} items={teamChats} onOpen={(id) => router.push(`/chats/${id}`)} />
      <ChatGroup title={t('chats.channels')} items={channels} onOpen={(id) => router.push(`/chats/${id}`)} />
      <ChatGroup title={t('chats.private')} items={privateChats} onOpen={(id) => router.push(`/chats/${id}`)} />
    </ScrollView>
  );
}

const ChatGroup = ({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: ChatSummary[];
  onOpen: (chatId: string) => void;
}) => (
  <View className="mb-4">
    <Text className="mb-1 font-semibold text-ink">{title}</Text>
    {items.map((chat) => (
      <Pressable key={chat.chatId} className="mb-2 rounded-xl bg-inset p-3" onPress={() => onOpen(chat.chatId)}>
        <Text className="text-ink">{chat.name ?? chat.chatId}</Text>
      </Pressable>
    ))}
  </View>
);
