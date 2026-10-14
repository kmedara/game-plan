/**
 * Accept a shared team invite code.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { InvitePreview } from '@gameplan/types';
import { inviteErrorMessage, roleLabel } from '@/src/roles';
import { useApp } from '@/src/state';
import { Button, ErrorText } from '@/src/ui';

export default function InviteScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { api, refreshTeams, selectTeam } = useApp();
  const [preview, setPreview] = useState<InvitePreview | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [joining, setJoining] = useState(false);
  const inviteCode = code ?? '';

  useEffect(() => {
    if (inviteCode.length === 0) {
      setError(t(inviteErrorMessage(new Error('not_found'))));
      return;
    }
    void api
      .getInvite(inviteCode)
      .then(setPreview)
      .catch((err: unknown) => setError(t(inviteErrorMessage(err))));
  }, [api, inviteCode, t]);

  const accept = async (): Promise<void> => {
    setJoining(true);
    setError(undefined);
    try {
      const membership = await api.acceptInvite(inviteCode);
      await refreshTeams();
      selectTeam(membership.teamId);
      router.replace('/schedule');
    } catch (err) {
      setError(t(inviteErrorMessage(err)));
      setJoining(false);
    }
  };

  return (
    <View className="flex-1 px-4 pt-6">
      <ErrorText message={error} />
      {preview === undefined && error === undefined ? <Text>{t('invite.loading')}</Text> : null}
      {preview !== undefined ? (
        <>
          <Text className="mb-2 text-2xl font-bold">{t('invite.joinTeamName', { name: preview.teamName })}</Text>
          <Text className="mb-4 text-slate-600">{t('invite.joinAsRole', { role: t(roleLabel(preview.role)) })}</Text>
          <Button label={t('invite.joinTeam')} onPress={() => void accept()} disabled={joining} />
        </>
      ) : null}
    </View>
  );
}
