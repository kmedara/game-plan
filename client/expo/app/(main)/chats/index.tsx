/**
 * Chat list for the active team plus private chats.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChatSummary } from '@gameplan/types';
import { useApp } from '@/src/state';
import { ErrorText, Field, SubmitButton } from '@/src/ui';

export default function ChatsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();
  const mode = action === 'private' || action === 'channel' ? action : undefined;
  const { api } = useApp();
  const teamId = api.selectedTeamId;
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [email, setEmail] = useState('');
  const [channelName, setChannelName] = useState('');
  const [error, setError] = useState<string | undefined>();

  const load = async (): Promise<void> => {
    setChats(await api.listChats());
  };

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'));
  }, [api, teamId]);

  const startPrivate = async (): Promise<void> => {
    const user = await api.searchChatUser(email);
    if (user.userId === api.user?.userId) throw new Error('self');
    const chat = await api.createPrivateChat([user.userId]);
    router.push(`/chats/${chat.chatId}`);
  };

  const startChannel = async (): Promise<void> => {
    if (teamId === undefined || channelName.trim().length === 0) throw new Error('name');
    const chat = await api.createTeamChannel(teamId, channelName.trim());
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
            message={(err) => {
              if (err instanceof Error && err.message === 'self') return t('chats.cannotChatSelf');
              if (err instanceof Error && err.message === 'not_found') return t('chats.userNotFound');
              return t('chats.searchFailed');
            }}
          />
        </View>
      ) : null}
      {mode === 'channel' ? (
        <View className="mb-4">
          <Field label={t('chats.channelName')} value={channelName} onChangeText={setChannelName} />
          <SubmitButton
            label={t('chats.createChannel')}
            onPress={startChannel}
            message={(err) =>
              err instanceof Error && err.message === 'name' ? t('chats.channelNameRequired') : t('chats.createFailed')
            }
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
