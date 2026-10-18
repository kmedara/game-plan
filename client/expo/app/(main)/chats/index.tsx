/**
 * Every team's chats, grouped under that team's name, plus private chats.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChatSummary } from '@gameplan/types';
import { groupChatsByTeam } from '@/src/chat-groups';
import { errorMessageKey, queryError } from '@/src/errors';
import { chatsQuery, createPrivateChatMutation, createTeamChannelMutation } from '@/src/queries/chat';
import { RefreshableScroll } from '@/src/pull-refresh';
import { membersQuery } from '@/src/queries/teams';
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
  const [chatName, setChatName] = useState('');
  const [pickedTeamId, setPickedTeamId] = useState<string | undefined>();
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [channelName, setChannelName] = useState('');
  const [channelTeamId, setChannelTeamId] = useState<string | undefined>();
  const rosters = useQueries({
    queries: teams.map((team) => ({ ...membersQuery(api, team.teamId), enabled: mode === 'private' })),
  });
  const failed = queryError(chatsLoaded.error);
  const error = failed !== undefined ? t(errorMessageKey(failed, 'errors.common.loadFailed')) : undefined;
  const teammateGroups = teams.map((team, index) => ({
    team,
    members: (rosters[index]?.data ?? []).filter((member) => member.userId !== api.user?.userId),
  }));

  const toggleTeammate = (teamId: string, userId: string): void => {
    if (pickedTeamId !== undefined && pickedTeamId !== teamId) {
      setPickedTeamId(teamId);
      setPickedIds([userId]);
      return;
    }
    setPickedTeamId(teamId);
    setPickedIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const startPrivate = async (): Promise<void> => {
    const name = chatName.trim();
    if (name.length === 0) throw new Error('name');
    const lead = pickedIds[0];
    if (lead === undefined) throw new Error('members');
    const chat = await startPrivateChat.mutateAsync({ memberIds: [lead, ...pickedIds.slice(1)], name });
    router.push(`/chats/${chat.chatId}`);
  };

  const startChannel = async (): Promise<void> => {
    const teamId = channelTeamId ?? (channelTeams.length === 1 ? channelTeams[0]?.teamId : undefined);
    if (teamId === undefined || channelName.trim().length === 0) throw new Error('name');
    const chat = await startChannelChat.mutateAsync({ teamId, name: channelName.trim() });
    router.push(`/chats/${chat.chatId}`);
  };

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      <Text className="mb-3 text-muted">{t('chats.hint')}</Text>
      {mode === 'private' ? (
        <View className="mb-4">
          <Field label={t('chats.chatName')} value={chatName} onChangeText={setChatName} />
          {teammateGroups.every((group) => group.members.length === 0) ? (
            <Text className="mb-2 text-muted">{t('chats.noTeammates')}</Text>
          ) : null}
          {teammateGroups.map((group) =>
            group.members.length === 0 ? null : (
              <View key={group.team.teamId} className="mb-3">
                {teams.length > 1 ? <Text className="mb-1 font-semibold text-ink">{group.team.name}</Text> : null}
                {group.members.map((member) => {
                  const selected = pickedTeamId === group.team.teamId && pickedIds.includes(member.userId);
                  return (
                    <Pressable
                      key={`${group.team.teamId}-${member.userId}`}
                      className={`mb-2 rounded-xl border px-3 py-2 ${selected ? 'border-ink bg-inset' : 'border-line'}`}
                      onPress={() => toggleTeammate(group.team.teamId, member.userId)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                    >
                      <Text className="text-ink">{member.displayName ?? t('common.unknownPerson')}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ),
          )}
          <SubmitButton
            label={t('chats.startPrivate')}
            onPress={startPrivate}
            message={(err) =>
              t(errorMessageKey(err, 'chats.createFailed', { name: 'chats.chatNameRequired', members: 'chats.pickTeammates' }))
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
    </RefreshableScroll>
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
