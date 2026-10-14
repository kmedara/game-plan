/**
 * Read-only profile for a teammate.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamMemberProfile } from '@gameplan/types';
import { roleLabel } from '@/src/roles';
import { useApp } from '@/src/state';
import { ErrorText } from '@/src/ui';

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
      {photoUrl !== undefined ? <Image source={{ uri: photoUrl }} className="mb-3 h-24 w-24 rounded-full" /> : null}
      <Text className="text-2xl font-bold">{member?.displayName}</Text>
      <Text className="text-slate-600">{member === undefined ? '' : t(roleLabel(member.role))}</Text>
      {member?.phoneNumber !== undefined ? <Text className="mt-2">{member.phoneNumber}</Text> : null}
      {member?.positions !== undefined && member.positions.length > 0 ? (
        <Text className="mt-2">{member.positions.join(', ')}</Text>
      ) : null}
    </View>
  );
}
