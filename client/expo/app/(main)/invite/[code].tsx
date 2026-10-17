/**
 * Accept a shared team invite code.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { acceptInviteMutation, invitePreviewQuery } from '@/src/queries/teams';
import { inviteErrorMessage, roleLabel } from '@/src/roles';
import { useApp } from '@/src/state';
import { ErrorText, SubmitButton } from '@/src/ui';

export default function InviteScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { api, selectTeam } = useApp();
  const queryClient = useQueryClient();
  const inviteCode = code ?? '';
  const preview = useQuery({
    ...invitePreviewQuery(api, inviteCode),
    enabled: inviteCode.length > 0,
  });
  const acceptInvite = useMutation(acceptInviteMutation(api, queryClient));
  const error =
    inviteCode.length === 0
      ? t(inviteErrorMessage(new Error('not_found')))
      : preview.error !== undefined
        ? t(inviteErrorMessage(preview.error))
        : undefined;

  const accept = async (): Promise<void> => {
    const membership = await acceptInvite.mutateAsync(inviteCode);
    selectTeam(membership.teamId);
    router.replace('/schedule');
  };

  return (
    <View className="flex-1 px-4 pt-6">
      <ErrorText message={error} />
      {preview.data === undefined && error === undefined ? <Text className="text-ink">{t('invite.loading')}</Text> : null}
      {preview.data !== undefined ? (
        <>
          <Text className="mb-2 text-2xl font-bold text-ink">{t('invite.joinTeamName', { name: preview.data.teamName })}</Text>
          <Text className="mb-4 text-muted">{t('invite.joinAsRole', { role: t(roleLabel(preview.data.role)) })}</Text>
          <SubmitButton label={t('invite.joinTeam')} onPress={accept} message={(err) => t(inviteErrorMessage(err))} />
        </>
      ) : null}
    </View>
  );
}
