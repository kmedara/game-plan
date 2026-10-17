/**
 * Teammate profile. Someone who can assign roles edits the role set here.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callerCanGrant, highestRole, rolesFromMembership } from '@gameplan/rules';
import { TEAM_ROLES, type TeamRole } from '@gameplan/types';
import { errorMessageKey } from '@/src/errors';
import { RoleSetPicker } from '@/src/role-picker';
import { useDownloadUrl } from '@/src/media';
import { assignMemberRolesMutation, memberQuery } from '@/src/queries/teams';
import { roleNames } from '@/src/roles';
import { useApp } from '@/src/state';
import { useTeamAccess } from '@/src/team-access';
import { ErrorText, ProfilePhoto, SubmitButton } from '@/src/ui';

export default function MemberProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { teamId, userId } = useLocalSearchParams<{ teamId: string; userId: string }>();
  const { api, teams } = useApp();
  const queryClient = useQueryClient();
  const id = teamId ?? '';
  const memberId = userId ?? '';
  const self = api.user?.userId === memberId;
  const access = useTeamAccess(teams.find((team) => team.teamId === id));
  const loaded = useQuery({
    ...memberQuery(api, id, memberId),
    enabled: !self && id.length > 0 && memberId.length > 0,
  });
  const saveRolesMutation = useMutation(assignMemberRolesMutation(api, queryClient, id, memberId));
  const member = loaded.data;
  const photoUrl = useDownloadUrl(member?.photoKey, { userId });
  const [draft, setDraft] = useState<TeamRole[]>([]);

  useEffect(() => {
    if (self) router.replace('/profile');
  }, [self, router]);

  useEffect(() => {
    if (member !== undefined) setDraft(rolesFromMembership(member));
  }, [member]);

  const top = access.roles.length > 0 ? highestRole(access.roles) : undefined;
  const grantable = top === undefined ? [] : TEAM_ROLES.filter((role) => callerCanGrant(top, role));
  const canAssign =
    member !== undefined &&
    top !== undefined &&
    access.can('assign_roles') &&
    rolesFromMembership(member).every((role) => callerCanGrant(top, role));

  const saveRoles = async (): Promise<boolean | void> => {
    if (member === undefined || draft.length === 0) return false;
    await saveRolesMutation.mutateAsync(draft);
  };

  return (
    <View className="flex-1 px-4 pt-4">
      <ErrorText message={loaded.error !== undefined ? t('errors.memberProfile.notFound') : undefined} />
      <View className="mb-3">
        <ProfilePhoto name={member?.displayName} uri={photoUrl} />
      </View>
      <Text className="text-2xl font-bold text-ink">{member?.displayName}</Text>
      {canAssign ? (
        <View className="mt-3">
          <Text className="mb-1 text-sm text-muted">{t('common.role')}</Text>
          <RoleSetPicker roles={grantable} value={draft} onChange={setDraft} />
          <SubmitButton
            label={t('common.save')}
            onPress={saveRoles}
            message={(err) => t(errorMessageKey(err, 'errors.memberProfile.saveRolesFailed'))}
          />
        </View>
      ) : (
        <Text className="text-muted">{member === undefined ? '' : roleNames(member, t)}</Text>
      )}
      {member?.phoneNumber !== undefined ? <Text className="mt-2 text-ink">{member.phoneNumber}</Text> : null}
      {member?.positions !== undefined && member.positions.length > 0 ? (
        <Text className="mt-2 text-ink">{member.positions.join(', ')}</Text>
      ) : null}
    </View>
  );
}
