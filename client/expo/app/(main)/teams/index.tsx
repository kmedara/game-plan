/**
 * Team list, directory join, invite code, and create.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View, type ScrollViewProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canCreateTeam } from '@gameplan/rules';
import type { TeamDirectoryHit } from '@gameplan/types';
import { inviteCodeFromInput } from '@/src/roles';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field, SubmitButton, TimeZoneField } from '@/src/ui';

const TEAM_PAGE = 10;

export default function TeamsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();
  const mode = action === 'join' || action === 'create' ? action : undefined;
  const { api, teams, refreshTeams, selectTeam, brand } = useApp();
  const showCreate = api.user === undefined || canCreateTeam(api.user.accountKind);
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('America/New_York');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    void refreshTeams().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'load_failed');
    });
  }, []);

  const requestJoin = async (team: TeamDirectoryHit): Promise<void> => {
    setError(undefined);
    try {
      await api.requestJoin(team.teamId);
      setMessage(t('teams.joinRequestSent'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    }
  };

  const create = async (): Promise<boolean | void> => {
    if (name.trim().length === 0) return false;
    const team = await api.createTeam({ name: name.trim(), timeZone: timeZone.trim() });
    selectTeam(team.teamId);
    await refreshTeams();
    router.push(`/teams/${team.teamId}`);
  };

  const openInvite = (): void => {
    const parsed = inviteCodeFromInput(code);
    if (parsed.length === 0) return;
    router.push(`/invite/${encodeURIComponent(parsed)}`);
  };

  return (
    <ScrollView className="flex-1 px-4 pt-4">
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
          <TimeZoneField label={t('teams.timeZone')} value={timeZone} onChange={setTimeZone} />
          <SubmitButton label={t('common.create')} onPress={create} />
        </View>
      ) : null}
    </ScrollView>
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
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<TeamDirectoryHit[]>([]);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestId = useRef(0);
  const loading = useRef(false);
  const cursor = useRef<string | undefined>(undefined);
  const queryRef = useRef(query);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  queryRef.current = query;

  const cancelClose = (): void => {
    if (closing.current === undefined) return;
    clearTimeout(closing.current);
    closing.current = undefined;
  };

  const load = async (text: string, pageCursor: string | undefined): Promise<void> => {
    const id = pageCursor === undefined ? ++requestId.current : requestId.current;
    if (pageCursor !== undefined && (loading.current || cursor.current === undefined)) return;
    loading.current = true;
    if (pageCursor === undefined) {
      cursor.current = undefined;
      setHits([]);
    }
    try {
      const page = await api.searchTeams(text, {
        limit: TEAM_PAGE,
        ...(pageCursor !== undefined ? { cursor: pageCursor } : {}),
      });
      if (id !== requestId.current) return;
      cursor.current = page.cursor;
      setHits((current) => (pageCursor === undefined ? page.teams : [...current, ...page.teams]));
    } catch {
      if (id !== requestId.current) return;
      cursor.current = undefined;
      if (pageCursor === undefined) setHits([]);
    } finally {
      if (id === requestId.current) loading.current = false;
    }
  };

  const loadMore = (): void => {
    if (!open || cursor.current === undefined) return;
    void load(queryRef.current, cursor.current);
  };

  const fillIfShort = (): void => {
    if (contentHeight.current > 0 && contentHeight.current <= viewportHeight.current + 8) loadMore();
  };

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      cursor.current = undefined;
      void load(query, undefined);
    }, 300);
    return () => clearTimeout(handle);
  }, [api, open, query]);

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
