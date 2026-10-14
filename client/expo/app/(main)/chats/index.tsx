/**
 * Chat list for the active team plus private chats.
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChatSummary } from '@gameplan/types';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field } from '@/src/ui';

export default function ChatsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api, teams } = useApp();
  const teamId = api.selectedTeamId;
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [mode, setMode] = useState<'private' | 'channel' | undefined>();
  const [email, setEmail] = useState('');
  const [channelName, setChannelName] = useState('');
  const [error, setError] = useState<string | undefined>();

  const load = async (): Promise<void> => {
    setChats(await api.listChats());
  };

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'));
    if (teamId === undefined) return;
    const role = teams.find((team) => team.teamId === teamId)?.role;
    if (role === undefined) return;
    void api.getPermissions(teamId).then((permissions) => {
      const mine = permissions.roles.find((row) => row.role === role);
      setCanCreate(mine?.permissions.includes('create_team_channels') ?? false);
    }).catch(() => setCanCreate(false));
  }, [api, teamId, teams]);

  const startPrivate = async (): Promise<void> => {
    setError(undefined);
    try {
      const user = await api.searchChatUser(email);
      if (user.userId === api.user?.userId) {
        setError(t('chats.cannotChatSelf'));
        return;
      }
      const chat = await api.createPrivateChat([user.userId]);
      router.push(`/chats/${chat.chatId}`);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(code === 'not_found' ? t('chats.userNotFound') : t('chats.searchFailed'));
    }
  };

  const startChannel = async (): Promise<void> => {
    if (teamId === undefined || channelName.trim().length === 0) {
      setError(t('chats.channelNameRequired'));
      return;
    }
    try {
      const chat = await api.createTeamChannel(teamId, channelName.trim());
      router.push(`/chats/${chat.chatId}`);
    } catch {
      setError(t('chats.createFailed'));
    }
  };

  const teamChats = chats.filter((chat) => chat.kind === 'default' && chat.teamId === teamId);
  const channels = chats.filter((chat) => chat.kind === 'channel' && chat.teamId === teamId);
  const privateChats = chats.filter((chat) => chat.kind === 'private');

  return (
    <ScrollView className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      <Text className="mb-3 text-slate-600">{t('chats.hint')}</Text>
      <Button label={t('chats.add')} onPress={() => setMode('private')} />
      {canCreate ? <Button label={t('chats.newChannel')} onPress={() => setMode('channel')} /> : null}
      {mode === 'private' ? (
        <View className="mb-4">
          <Field label={t('chats.email')} value={email} onChangeText={setEmail} />
          <Button label={t('chats.startPrivate')} onPress={() => void startPrivate()} />
        </View>
      ) : null}
      {mode === 'channel' ? (
        <View className="mb-4">
          <Field label={t('chats.channelName')} value={channelName} onChangeText={setChannelName} />
          <Button label={t('chats.createChannel')} onPress={() => void startChannel()} />
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
    <Text className="mb-1 font-semibold">{title}</Text>
    {items.map((chat) => (
      <Pressable key={chat.chatId} className="mb-2 rounded bg-white p-3" onPress={() => onOpen(chat.chatId)}>
        <Text>{chat.name ?? chat.chatId}</Text>
      </Pressable>
    ))}
  </View>
);
