/**
 * Per-role permission checkboxes. Saving rejects a change that would leave a minor in a managing role.
 */

import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { roleAllowedForAccount } from '@gameplan/rules';
import { TEAM_PERMISSIONS, type RolePermissions, type TeamMember } from '@gameplan/types';
import { roleLabel } from '@/src/roles';
import { useApp } from '@/src/state';
import { SubmitButton } from '@/src/ui';

export const TeamPermissions = ({
  teamId,
  roles,
  setRoles,
  members,
}: {
  teamId: string;
  roles: RolePermissions[];
  setRoles: (update: RolePermissions[] | ((current: RolePermissions[]) => RolePermissions[])) => void;
  members: TeamMember[];
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  if (roles.length === 0) return null;

  const toggle = (role: string, permission: RolePermissions['permissions'][number], checked: boolean): void => {
    setRoles((current) =>
      current.map((row) => {
        if (row.role !== role) return row;
        const permissions = checked
          ? [...row.permissions, permission]
          : row.permissions.filter((item) => item !== permission);
        return { ...row, permissions };
      }),
    );
  };

  const savePermissions = async (): Promise<void> => {
    const blocked = roles.some((row) =>
      members.some(
        (member) =>
          member.role === row.role &&
          member.accountKind !== undefined &&
          !roleAllowedForAccount(member.accountKind, row.role, row.permissions),
      ),
    );
    if (blocked) throw new Error('minor_cannot_hold_manage_permissions');
    const saved = await api.putPermissions(teamId, roles);
    setRoles(saved.roles);
  };

  return (
    <View className="mb-8 mt-4">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('teamAdmin.permissions')}</Text>
      {roles.map((row) => {
        const locked = row.role === 'team_admin';
        return (
          <View key={row.role} className="mb-3">
            <Text className="font-semibold text-ink">{t(roleLabel(row.role))}</Text>
            {TEAM_PERMISSIONS.map((permission) => {
              const checked = row.permissions.includes(permission);
              return (
                <Pressable
                  key={permission}
                  disabled={locked}
                  onPress={() => toggle(row.role, permission, !checked)}
                >
                  <Text className={locked ? 'text-muted' : 'text-ink'}>{checked ? '☑' : '☐'} {permission}</Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}
      <SubmitButton label={t('common.save')} onPress={savePermissions} />
    </View>
  );
};
