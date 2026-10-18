/**
 * Every team's chats, grouped under that team's name, plus private chats.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChatSummary } from '@gameplan/types';
import { groupChatsByTeam } from '@/src/chat-groups';
import { errorMessageKey, queryError } from '@/src/errors';
import { chatsQuery, createPrivateChatMutation, createTeamChannelMutation } from '@/src/queries/chat';
import { useApp } from '@/src/state';
import { useTeamsWithPermission } from '@/src/team-access';
import { brandColors } from '@/src/theme';
import { ErrorText, Field, SubmitButton } from '@/src/ui';

export default function ChatsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();
  const mode = action === 'private' || action === 'channel' ? action : undefined;
  const { api, teams } = useApp();
  const queryClient = useQueryClient();
  const chatsLoaded = useQuery(chatsQuery(api));
  const startPrivateChat = useMutation(createPrivateChatMutation(api, queryClient));
  const startChannelChat = useMutation(createTeamChannelMutation(api, queryClient));
  const channelTeams = useTeamsWithPermission('create_team_channels', mode === 'channel');
  const chats = chatsLoaded.data ?? [];
  const grouped = groupChatsByTeam(teams, chats);
  const [email, setEmail] = useState('');
  const [channelName, setChannelName] = useState('');
  const [channelTeamId, setChannelTeamId] = useState<string | undefined>();
  const failed = queryError(chatsLoaded.error);
  const error = failed !== undefined ? t(errorMessageKey(failed, 'errors.common.loadFailed')) : undefined;

  const startPrivate = async (): Promise<void> => {
    const user = await api.searchChatUser(email);
    if (user.userId === api.user?.userId) throw new Error('self');
    const chat = await startPrivateChat.mutateAsync([user.userId]);
    router.push(`/chats/${chat.chatId}`);
  };

  const startChannel = async (): Promise<void> => {
    const teamId = channelTeamId ?? (channelTeams.length === 1 ? channelTeams[0]?.teamId : undefined);
    if (teamId === undefined || channelName.trim().length === 0) throw new Error('name');
    const chat = await startChannelChat.mutateAsync({ teamId, name: channelName.trim() });
    router.push(`/chats/${chat.chatId}`);
  };

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
      {mode === 'channel' && channelTeams.length > 1 && channelTeamId === undefined ? (
        <View className="mb-4">
          <Text className="mb-2 text-muted">{t('chats.chooseTeam')}</Text>
          {channelTeams.map((team) => (
            <Pressable
              key={team.teamId}
              className="mb-2 rounded-xl bg-inset p-4"
              onPress={() => setChannelTeamId(team.teamId)}
            >
              <Text className="text-lg font-semibold text-ink">{team.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {mode === 'channel' && (channelTeams.length === 1 || channelTeamId !== undefined) ? (
        <View className="mb-4">
          <Field label={t('chats.channelName')} value={channelName} onChangeText={setChannelName} />
          <SubmitButton
            label={t('chats.createChannel')}
            onPress={startChannel}
            message={(err) => t(errorMessageKey(err, 'chats.createFailed', { name: 'chats.channelNameRequired' }))}
          />
        </View>
      ) : null}
      {grouped.sections.map((section) => (
        <View key={section.team.teamId} className="mb-4">
          <View className="mb-1 flex-row items-center">
            <View
              className="mr-2 h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: brandColors(section.team.theme).accent }}
            />
            <Text className="font-semibold text-ink">{section.team.name}</Text>
          </View>
          {section.chats.map((chat) => (
            <Pressable
              key={chat.chatId}
              className="mb-2 rounded-xl bg-inset p-3"
              onPress={() => router.push(`/chats/${chat.chatId}`)}
            >
              <Text className="text-ink">{chat.name ?? chat.chatId}</Text>
            </Pressable>
          ))}
        </View>
      ))}
      {grouped.privateChats.length > 0 ? (
        <ChatGroup title={t('chats.private')} items={grouped.privateChats} onOpen={(id) => router.push(`/chats/${id}`)} />
      ) : null}
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
