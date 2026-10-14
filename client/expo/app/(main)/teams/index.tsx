/**
 * Team list, directory join, invite code, and create.
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canCreateTeam } from '@gameplan/rules';
import type { TeamDirectoryHit } from '@gameplan/types';
import { inviteCodeFromInput } from '@/src/roles';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field } from '@/src/ui';

export default function TeamsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api, teams, refreshTeams, selectTeam } = useApp();
  const showCreate = api.user === undefined || canCreateTeam(api.user.accountKind);
  const [mode, setMode] = useState<'join' | 'create' | undefined>();
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
    setError(undefined);
    try {
      const team = await api.createTeam({ name: name.trim(), timeZone: timeZone.trim() });
      selectTeam(team.teamId);
      await refreshTeams();
      router.push(`/teams/${team.teamId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    }
  };

  const openInvite = (): void => {
    const parsed = inviteCodeFromInput(code);
    if (parsed.length === 0) return;
    router.push(`/invite/${encodeURIComponent(parsed)}`);
  };

  return (
    <ScrollView className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      {message !== undefined ? <Text className="mb-2 text-teal-800">{message}</Text> : null}
      {teams.length === 0 ? <Text className="mb-4 text-slate-600">{t('teams.empty')}</Text> : null}
      {teams.map((team) => (
        <Pressable
          key={team.teamId}
          className="mb-2 rounded-lg bg-white p-4"
          onPress={() => {
            selectTeam(team.teamId);
            router.push(`/teams/${team.teamId}`);
          }}
        >
          <Text className="text-lg font-semibold">{team.name}</Text>
          <Text className="text-slate-500">{team.timeZone}</Text>
        </Pressable>
      ))}
      <View className="mt-2 flex-row">
        <View className="mr-2 flex-1">
          <Button label={t('teams.joinTeam')} onPress={() => setMode('join')} />
        </View>
        {showCreate ? (
          <View className="flex-1">
            <Button label={t('teams.createTeam')} onPress={() => setMode('create')} />
          </View>
        ) : null}
      </View>
      {mode === 'join' ? (
        <View className="mb-6">
          <Field label={t('teams.searchByName')} value={query} onChangeText={setQuery} />
          {hits.map((hit) => (
            <Pressable key={hit.teamId} className="mb-2 rounded border border-slate-200 p-3" onPress={() => void requestJoin(hit)}>
              <Text>{hit.name}</Text>
            </Pressable>
          ))}
          <Field label={t('teams.inviteCode')} value={code} onChangeText={setCode} />
          <Button label={t('invite.joinTeam')} onPress={openInvite} />
        </View>
      ) : null}
      {showCreate && mode === 'create' ? (
        <View className="mb-6">
          <Field label={t('teams.team')} value={name} onChangeText={setName} />
          <Field label={t('teams.timeZone')} value={timeZone} onChangeText={setTimeZone} />
          <Button label={t('common.create')} onPress={() => void create()} />
        </View>
      ) : null}
    </ScrollView>
  );
}
