/**
 * Team roster list. Each row opens that member.
 */

import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamMember } from '@gameplan/types';
import { heldRoles, roleLabel } from '@/src/roles';

export const TeamRoster = ({ teamId, members }: { teamId: string; members: TeamMember[] }) => {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <>
      <Text className="mb-2 mt-4 text-lg font-semibold text-ink">{t('teamAdmin.roster')}</Text>
      {members.map((member) => (
        <Pressable
          key={member.userId}
          className="mb-2 rounded-xl bg-inset p-3"
          onPress={() => router.push(`/teams/${teamId}/members/${member.userId}`)}
        >
          <Text className="text-ink">{member.displayName ?? member.userId}</Text>
          <Text className="text-muted">{heldRoles(member).map((role) => t(roleLabel(role))).join(', ')}</Text>
        </Pressable>
      ))}
    </>
  );
};
