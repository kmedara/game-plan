/**
 * Team list, organizations link, directory join, invite code, and create.
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View, type ScrollViewProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canCreateTeam } from '@gameplan/rules';
import type { TeamDirectoryHit } from '@gameplan/types';
import { errorMessageKey } from '@/src/errors';
import { createTeamMutation, directoryQuery, requestJoinMutation } from '@/src/queries/teams';
import { RefreshableScroll } from '@/src/pull-refresh';
import { inviteCodeFromInput } from '@/src/roles';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field, SubmitButton, TimeZoneField } from '@/src/ui';

export default function TeamsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();
  const mode = action === 'join' || action === 'create' ? action : undefined;
  const { api, teams, selectTeam, brand } = useApp();
  const queryClient = useQueryClient();
  const createTeam = useMutation(createTeamMutation(api, queryClient));
  const requestJoinTeam = useMutation(requestJoinMutation(api));
  const showCreate = api.user === undefined || canCreateTeam(api.user.accountKind);
  const [name, setName] = useState('');
  const [sport, setSport] = useState('');
  const [timeZone, setTimeZone] = useState('America/New_York');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const requestJoin = async (team: TeamDirectoryHit): Promise<void> => {
    setError(undefined);
    try {
      await requestJoinTeam.mutateAsync(team.teamId);
      setMessage(t('teams.joinRequestSent'));
    } catch (err) {
      setError(t(errorMessageKey(err, 'errors.common.requestFailed', { already_a_member: 'errors.invite.alreadyMember' })));
    }
  };

  const create = async (): Promise<boolean | void> => {
    if (name.trim().length === 0) return false;
    const team = await createTeam.mutateAsync({
      name: name.trim(),
      timeZone: timeZone.trim(),
      ...(sport.trim().length > 0 ? { sport: sport.trim() } : {}),
    });
    selectTeam(team.teamId);
    router.push(`/teams/${team.teamId}`);
  };

  const openInvite = (): void => {
    const parsed = inviteCodeFromInput(code);
    if (parsed.length === 0) return;
    router.push(`/invite/${encodeURIComponent(parsed)}`);
  };

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      {message !== undefined ? <Text className="mb-2" style={{ color: brand.secondary }}>{message}</Text> : null}
      {teams.length === 0 ? <Text className="mb-4 text-muted">{t('teams.empty')}</Text> : null}
      {teams.map((team) => (
        <Pressable
          key={team.teamId}
          className="mb-2 rounded-xl bg-inset p-4"
          onPress={() => {
            selectTeam(team.teamId);
            router.push(`/teams/${team.teamId}`);
          }}
        >
          <Text className="text-lg font-semibold text-ink">{team.name}</Text>
          <Text className="text-muted">{team.timeZone}</Text>
        </Pressable>
      ))}
      {api.user?.accountKind === 'adult' ? (
        <View className="mb-4 mt-2">
          <Button label={t('orgs.title')} tone="secondary" onPress={() => router.push('/orgs')} />
        </View>
      ) : null}
      {mode === 'join' ? (
        <View className="mb-6">
          <TeamSearchField label={t('teams.searchByName')} onSelect={(hit) => void requestJoin(hit)} />
          <Field label={t('teams.inviteCode')} value={code} onChangeText={setCode} />
          <Button label={t('invite.joinTeam')} onPress={openInvite} />
        </View>
      ) : null}
      {showCreate && mode === 'create' ? (
        <View className="mb-6">
          <Field label={t('teams.team')} value={name} onChangeText={setName} />
          <Field label={t('teams.sport')} value={sport} onChangeText={setSport} />
          <TimeZoneField label={t('teams.timeZone')} value={timeZone} onChange={setTimeZone} />
          <SubmitButton label={t('common.create')} onPress={create} />
        </View>
      ) : null}
    </RefreshableScroll>
  );
}

/** Name autocomplete. Each page is 10 teams, and scrolling the list loads the next page. */
const TeamSearchField = ({
  label,
  onSelect,
}: {
  label: string;
  onSelect: (team: TeamDirectoryHit) => void;
}) => {
  const { api } = useApp();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const directory = useInfiniteQuery({ ...directoryQuery(api, debounced), enabled: open });
  const hits = directory.data?.pages.flatMap((page) => page.teams) ?? [];

  const cancelClose = (): void => {
    if (closing.current === undefined) return;
    clearTimeout(closing.current);
    closing.current = undefined;
  };

  const loadMore = (): void => {
    if (!open || !directory.hasNextPage || directory.isFetchingNextPage) return;
    void directory.fetchNextPage();
  };

  const fillIfShort = (): void => {
    if (contentHeight.current > 0 && contentHeight.current <= viewportHeight.current + 8) loadMore();
  };

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <View className="mb-3" style={{ zIndex: open ? 20 : 0 }}>
      <Text className="mb-1 text-sm text-muted">{label}</Text>
      <View>
        <TextInput
          className="rounded-xl border border-line bg-inset px-3 py-2 text-base text-ink"
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            cancelClose();
            closing.current = setTimeout(() => setOpen(false), 150);
          }}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {open && hits.length > 0 ? (
          <ScrollView
            className="absolute left-0 right-0 top-full z-20 max-h-60 rounded-xl border border-line bg-paper"
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            onLayout={(event) => {
              viewportHeight.current = event.nativeEvent.layout.height;
              fillIfShort();
            }}
            onContentSizeChange={(_width, height) => {
              contentHeight.current = height;
              fillIfShort();
            }}
            onScroll={(event) => {
              const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
              if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 24) loadMore();
            }}
            onTouchStart={cancelClose}
            {...(Platform.OS === 'web'
              ? ({
                  onMouseDown: (event: { preventDefault: () => void }) => {
                    event.preventDefault();
                    cancelClose();
                  },
                } as unknown as ScrollViewProps)
              : null)}
          >
            {hits.map((hit) => (
              <Pressable
                key={hit.teamId}
                className="border-b border-line px-3 py-2"
                onPressIn={() => {
                  cancelClose();
                  setQuery(hit.name);
                  setOpen(false);
                  onSelect(hit);
                }}
              >
                <Text className="text-ink">{hit.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}
