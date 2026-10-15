/**
 * Read-only profile for a teammate.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamMemberProfile } from '@gameplan/types';
import { roleLabel } from '@/src/roles';
import { useApp } from '@/src/state';
import { ErrorText, ProfilePhoto } from '@/src/ui';

export default function MemberProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { teamId, userId } = useLocalSearchParams<{ teamId: string; userId: string }>();
  const { api } = useApp();
  const [member, setMember] = useState<TeamMemberProfile | undefined>();
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const id = teamId ?? '';
    const memberId = userId ?? '';
    if (api.user?.userId === memberId) {
      router.replace('/profile');
      return;
    }
    void api
      .getMember(id, memberId)
      .then(async (next) => {
        setMember(next);
        if (next.photoKey !== undefined) {
          const download = await api.presignDownload(next.photoKey, { userId: memberId });
          setPhotoUrl(download.downloadUrl);
        }
      })
      .catch(() => setError(t('errors.memberProfile.notFound')));
  }, [api, teamId, userId, router, t]);

  return (
    <View className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      <View className="mb-3">
        <ProfilePhoto name={member?.displayName} uri={photoUrl} />
      </View>
      <Text className="text-2xl font-bold text-ink">{member?.displayName}</Text>
      <Text className="text-muted">{member === undefined ? '' : t(roleLabel(member.role))}</Text>
      {member?.phoneNumber !== undefined ? <Text className="mt-2 text-ink">{member.phoneNumber}</Text> : null}
      {member?.positions !== undefined && member.positions.length > 0 ? (
        <Text className="mt-2 text-ink">{member.positions.join(', ')}</Text>
      ) : null}
    </View>
  );
}
