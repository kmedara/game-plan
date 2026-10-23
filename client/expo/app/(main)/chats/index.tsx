/**
 * Every team's chats, grouped under that team's name, plus private chats.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import X from 'lucide-react-native/icons/x';
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
import { parseTeammateChoiceId, searchTeammates } from '@/src/teammate-search';
import { brandColors, colors } from '@/src/theme';
import { AutocompleteField, ErrorText, Field, SubmitButton } from '@/src/ui';

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

  const pickedMembers = teammateGroups
    .find((group) => group.team.teamId === pickedTeamId)
    ?.members.filter((member) => pickedIds.includes(member.userId)) ?? [];
  // The server adds a minor's linked guardians whenever an outside adult is in the chat.
  const adultInChat =
    api.user?.accountKind === 'adult' || pickedMembers.some((member) => member.accountKind === 'adult');
  const pickedMinorNames = adultInChat
    ? pickedMembers
        .filter((member) => member.accountKind === 'minor')
        .map((member) => member.displayName ?? t('common.unknownPerson'))
    : [];

  const addTeammate = (choiceId: string): void => {
    const { teamId, userId } = parseTeammateChoiceId(choiceId);
    setPickedTeamId(teamId);
    setPickedIds((current) => (current.includes(userId) ? current : [...current, userId]));
  };

  const removeTeammate = (userId: string): void => {
    const remaining = pickedIds.filter((id) => id !== userId);
    setPickedIds(remaining);
    if (remaining.length === 0) setPickedTeamId(undefined);
  };

  const openChat = (chatId: string): void => router.push(`/chats/${chatId}`);

  const startPrivate = async (): Promise<void> => {
    const lead = pickedIds[0];
    if (lead === undefined) throw new Error('members');
    const chat = await startPrivateChat.mutateAsync({ memberIds: [lead, ...pickedIds.slice(1)] });
    openChat(chat.chatId);
  };

  const startChannel = async (): Promise<void> => {
    const teamId = channelTeamId ?? (channelTeams.length === 1 ? channelTeams[0]?.teamId : undefined);
    if (teamId === undefined || channelName.trim().length === 0) throw new Error('name');
    const chat = await startChannelChat.mutateAsync({ teamId, name: channelName.trim() });
    openChat(chat.chatId);
  };

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      <Text className="mb-3 text-base text-muted">{t('chats.hint')}</Text>
      {mode === 'private' ? (
        <View className="mb-4">
          {teammateGroups.every((group) => group.members.length === 0) ? (
            <Text className="mb-2 text-base text-muted">{t('chats.noTeammates')}</Text>
          ) : (
            <AutocompleteField
              label={t('chats.teammates')}
              text=""
              placeholder={t('chats.searchTeammates')}
              search={(query) =>
                searchTeammates({
                  groups: teammateGroups,
                  pickedTeamId,
                  pickedIds,
                  query,
                  showTeam: teams.length > 1,
                  unknownName: t('common.unknownPerson'),
                  callerIsAdult: api.user?.accountKind === 'adult',
                  noGuardianReason: t('chats.noGuardian'),
                })
              }
              onPick={(choice) => addTeammate(choice.id)}
            />
          )}
          {pickedMembers.length > 0 ? (
            <View className="mb-3 flex-row flex-wrap">
              {pickedMembers.map((member) => {
                const name = member.displayName ?? t('common.unknownPerson');
                return (
                  <Pressable
                    key={member.userId}
                    className="mb-2 mr-2 flex-row items-center rounded-full border border-line bg-inset py-1 pl-3 pr-2"
                    onPress={() => removeTeammate(member.userId)}
                    accessibilityRole="button"
                    accessibilityLabel={t('chats.removeTeammate', { name })}
                  >
                    <Text className="mr-1 text-ink">{name}</Text>
                    <X size={14} color={colors.muted} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {pickedMinorNames.length > 0 ? (
            <Text className="mb-3 text-base text-muted">
              {t('chats.guardiansAdded', { names: pickedMinorNames.join(', ') })}
            </Text>
          ) : null}
          <SubmitButton
            label={t('chats.startPrivate')}
            onPress={startPrivate}
            message={(err) =>
              t(errorMessageKey(err, 'chats.createFailed', { members: 'chats.pickTeammates' }))
            }
          />
        </View>
      ) : null}
      {mode === 'channel' && channelTeams.length > 1 && channelTeamId === undefined ? (
        <View className="mb-4">
          <Text className="mb-2 text-base text-muted">{t('chats.chooseTeam')}</Text>
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
        <ChatGroup
          key={section.team.teamId}
          title={section.team.name}
          accent={brandColors(section.team.theme).accent}
          items={section.chats}
          onOpen={openChat}
        />
      ))}
      {grouped.privateChats.length > 0 ? (
        <ChatGroup title={t('chats.private')} items={grouped.privateChats} onOpen={openChat} />
      ) : null}
    </RefreshableScroll>
  );
}

/** One heading and its chats. A team heading leads with that team's accent dot. */
const ChatGroup = ({
  title,
  accent,
  items,
  onOpen,
}: {
  title: string;
  accent?: string;
  items: ChatSummary[];
  onOpen: (chatId: string) => void;
}) => (
  <View className="mb-4">
    <View className="mb-1 flex-row items-center">
      {accent !== undefined ? <View className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} /> : null}
      <Text className="text-base font-semibold text-ink">{title}</Text>
    </View>
    {items.map((chat) => (
      <Pressable key={chat.chatId} className="mb-2 rounded-xl bg-inset p-3" onPress={() => onOpen(chat.chatId)}>
        <Text className="text-base text-ink">{chat.name ?? chat.chatId}</Text>
      </Pressable>
    ))}
  </View>
);
