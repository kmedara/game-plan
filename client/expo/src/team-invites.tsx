/**
 * Role invite links the caller can create, copy, and delete.
 */

import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callerCanGrant } from '@gameplan/rules';
import { TEAM_ROLES, type TeamInvite, type TeamRole } from '@gameplan/types';
import { roleLabel } from '@/src/roles';
import { RolePicker } from '@/src/role-picker';
import { useApp } from '@/src/state';
import { TrashIcon } from '@/src/team-media';
import { Button } from '@/src/ui';

export const TeamInvites = ({
  teamId,
  invites,
  setInvites,
  callerRole,
  onError,
}: {
  teamId: string;
  invites: TeamInvite[];
  setInvites: (update: (current: TeamInvite[]) => TeamInvite[]) => void;
  callerRole: TeamRole;
  onError: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [inviteRole, setInviteRole] = useState<TeamRole>('player');
  const grantableRoles = TEAM_ROLES.filter((role) => callerCanGrant(callerRole, role));

  const createInvite = async (role: TeamRole): Promise<void> => {
    try {
      const invite = await api.createInvite(teamId, role);
      setInvites((current) => {
        const rest = current.filter((item) => item.role !== invite.role);
        return [invite, ...rest];
      });
      await Clipboard.setStringAsync(invite.code);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'request_failed');
    }
  };

  const removeInvite = async (role: TeamRole): Promise<void> => {
    try {
      await api.deleteInvite(teamId, role);
      setInvites((current) => current.filter((invite) => invite.role !== role));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'request_failed');
    }
  };

  return (
    <>
      <Text className="mb-2 mt-2 text-lg font-semibold text-ink">{t('teamAdmin.inviteMembers')}</Text>
      <Text className="mb-2 text-muted">{t('teamAdmin.inviteHint')}</Text>
      <RolePicker roles={grantableRoles} value={inviteRole} onChange={setInviteRole} />
      <Button
        label={
          invites.some((invite) => invite.role === inviteRole)
            ? t('common.copyLink')
            : t('teamAdmin.createInviteLink')
        }
        onPress={() => void createInvite(inviteRole)}
      />
      {invites.map((invite) => (
        <View key={invite.role} className="mb-2 flex-row items-center rounded-xl bg-inset p-3">
          <Pressable className="flex-1" onPress={() => void Clipboard.setStringAsync(invite.code)}>
            <Text className="font-semibold text-ink">{t(roleLabel(invite.role))}</Text>
            <Text className="text-ink">{invite.code}</Text>
            <Text className="text-muted">{t('common.copyLink')}</Text>
          </Pressable>
          <Pressable
            className="ml-3"
            onPress={() => void removeInvite(invite.role)}
            accessibilityRole="button"
            accessibilityLabel={t('teamAdmin.deleteInvite')}
          >
            <TrashIcon />
          </Pressable>
        </View>
      ))}
    </>
  );
};
