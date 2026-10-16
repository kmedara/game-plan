/**
 * Teammate profile. Someone who can assign roles edits the role set here.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callerCanGrant, highestRole } from '@gameplan/rules';
import { TEAM_ROLES, type TeamMemberProfile, type TeamRole } from '@gameplan/types';
import { RoleSetPicker } from '@/src/role-picker';
import { heldRoles, memberHasPermission, roleLabel } from '@/src/roles';
import { useApp } from '@/src/state';
import { ErrorText, ProfilePhoto, SubmitButton } from '@/src/ui';

export default function MemberProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { teamId, userId } = useLocalSearchParams<{ teamId: string; userId: string }>();
  const { api } = useApp();
  const [member, setMember] = useState<TeamMemberProfile | undefined>();
  const [draft, setDraft] = useState<TeamRole[]>([]);
  const [grantable, setGrantable] = useState<TeamRole[]>([]);
  const [canAssign, setCanAssign] = useState(false);
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
        setDraft(heldRoles(next));
        if (next.photoKey !== undefined) {
          const download = await api.presignDownload(next.photoKey, { userId: memberId });
          setPhotoUrl(download.downloadUrl);
        }
        const [team, permissions] = await Promise.all([
          api.getTeam(id),
          api.getPermissions(id).catch(() => undefined),
        ]);
        const mine = heldRoles(team);
        const matrix = permissions?.roles ?? [];
        const top = highestRole(mine);
        const allowed =
          memberHasPermission(mine, matrix, 'assign_roles') &&
          heldRoles(next).every((role) => callerCanGrant(top, role));
        setCanAssign(allowed);
        setGrantable(TEAM_ROLES.filter((role) => callerCanGrant(top, role)));
      })
      .catch(() => setError(t('errors.memberProfile.notFound')));
  }, [api, teamId, userId, router, t]);

  const saveRoles = async (): Promise<boolean | void> => {
    const id = teamId ?? '';
    const memberId = userId ?? '';
    if (draft.length === 0) return false;
    const saved = await api.assignMemberRoles(id, memberId, draft);
    setMember((current) => ({ ...current, ...saved }));
    setDraft(heldRoles(saved));
  };

  const roleSaveMessage = (err: unknown): string => {
    const code = err instanceof Error ? err.message : '';
    if (code === 'role_outranks_caller') return t('errors.memberProfile.roleOutranks');
    if (code === 'minor_cannot_be_team_admin' || code === 'minor_cannot_hold_manage_permissions') {
      return t('errors.invite.roleUnavailable');
    }
    return t('errors.memberProfile.saveRolesFailed');
  };

  const roleText =
    member === undefined ? '' : heldRoles(member).map((role) => t(roleLabel(role))).join(', ');

  return (
    <View className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      <View className="mb-3">
        <ProfilePhoto name={member?.displayName} uri={photoUrl} />
      </View>
      <Text className="text-2xl font-bold text-ink">{member?.displayName}</Text>
      {canAssign ? (
        <View className="mt-3">
          <Text className="mb-1 text-sm text-muted">{t('common.role')}</Text>
          <RoleSetPicker roles={grantable} value={draft} onChange={setDraft} />
          <SubmitButton label={t('common.save')} onPress={saveRoles} message={roleSaveMessage} />
        </View>
      ) : (
        <Text className="text-muted">{roleText}</Text>
      )}
      {member?.phoneNumber !== undefined ? <Text className="mt-2 text-ink">{member.phoneNumber}</Text> : null}
      {member?.positions !== undefined && member.positions.length > 0 ? (
        <Text className="mt-2 text-ink">{member.positions.join(', ')}</Text>
      ) : null}
    </View>
  );
}
