/**
 * Team roster list. Each row opens that member and offers call, text, or a private chat.
 */

import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamMember } from '@gameplan/types';
import { ContactButtons } from '@/src/contact-buttons';
import { roleNames } from '@/src/roles';
import { useApp } from '@/src/state';

export const TeamRoster = ({
  teamId,
  members,
  onError,
}: {
  teamId: string;
  members: TeamMember[];
  onError: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { api } = useApp();
  const selfId = api.user?.userId;

  return (
    <>
      <Text className="mb-2 mt-4 text-lg font-semibold text-ink">{t('teamAdmin.roster')}</Text>
      {members.map((member) => (
        <View key={member.userId} className="mb-2 flex-row items-center rounded-xl bg-inset p-3">
          <Pressable className="flex-1" onPress={() => router.push(`/teams/${teamId}/members/${member.userId}`)}>
            <Text className="text-ink">{member.displayName ?? member.userId}</Text>
            <Text className="text-muted">{roleNames(member, t)}</Text>
          </Pressable>
          {member.userId !== selfId ? (
            <ContactButtons userId={member.userId} phone={member.phoneNumber} onError={onError} />
          ) : null}
        </View>
      ))}
    </>
  );
};
