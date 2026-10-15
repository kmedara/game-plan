/**
 * Team list, directory join, invite code, and create.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canCreateTeam } from '@gameplan/rules';
import type { TeamDirectoryHit } from '@gameplan/types';
import { inviteCodeFromInput } from '@/src/roles';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field, SubmitButton, TimeZoneField } from '@/src/ui';

export default function TeamsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { action } = useLocalSearchParams<{ action?: string }>();
  const mode = action === 'join' || action === 'create' ? action : undefined;
  const { api, teams, refreshTeams, selectTeam, brand } = useApp();
  const showCreate = api.user === undefined || canCreateTeam(api.user.accountKind);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<TeamDirectoryHit[]>([]);
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

  useEffect(() => {
    const handle = setTimeout(() => {
      void api
        .searchTeams(query, { limit: 10 })
        .then((page) => setHits(page.teams))
        .catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [api, query]);

  const requestJoin = async (team: TeamDirectoryHit): Promise<void> => {
    setError(undefined);
    try {
      await api.requestJoin(team.teamId);
      setMessage(t('teams.joinRequestSent'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    }
  };

  const create = async (): Promise<void> => {
    if (name.trim().length === 0) return;
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
          <Field label={t('teams.searchByName')} value={query} onChangeText={setQuery} />
          {hits.map((hit) => (
            <Pressable key={hit.teamId} className="mb-2 rounded-xl border border-line bg-paper p-3" onPress={() => void requestJoin(hit)}>
              <Text className="text-ink">{hit.name}</Text>
            </Pressable>
          ))}
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
