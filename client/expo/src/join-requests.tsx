/**
 * Pending join requests, with a role the caller is allowed to grant.
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callerCanGrant, roleAllowedForAccount } from '@gameplan/rules';
import { TEAM_ROLES, type JoinRequest, type RolePermissions, type TeamRole } from '@gameplan/types';
import { joinRequestMessage } from '@/src/roles';
import { RolePicker } from '@/src/role-picker';
import { useApp } from '@/src/state';

export const JoinRequests = ({
  teamId,
  requests,
  roles,
  callerRole,
  reload,
  onError,
}: {
  teamId: string;
  requests: JoinRequest[];
  roles: RolePermissions[];
  callerRole: TeamRole;
  reload: () => Promise<void>;
  onError: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [joinRoles, setJoinRoles] = useState<Record<string, TeamRole>>({});

  const rolesFor = (request: JoinRequest): TeamRole[] =>
    TEAM_ROLES.filter((role) => {
      if (!callerCanGrant(callerRole, role)) return false;
      if (request.accountKind === undefined) return true;
      const permissions = roles.find((row) => row.role === role)?.permissions ?? [];
      return roleAllowedForAccount(request.accountKind, role, permissions);
    });

  const approve = async (request: JoinRequest): Promise<void> => {
    const allowed = rolesFor(request);
    const role =
      joinRoles[request.requestId] ??
      (allowed.includes('player') ? 'player' : allowed[allowed.length - 1]);
    if (role === undefined) return;
    try {
      await api.approveJoinRequest(teamId, request.requestId, role);
      await reload();
    } catch (err) {
      onError(t(joinRequestMessage(err)));
    }
  };

  const decline = async (request: JoinRequest): Promise<void> => {
    try {
      await api.rejectJoinRequest(teamId, request.requestId);
      await reload();
    } catch (err) {
      onError(t(joinRequestMessage(err)));
    }
  };

  return (
    <>
      <Text className="mb-2 mt-4 text-lg font-semibold text-ink">{t('teamAdmin.joinRequests')}</Text>
      {requests.map((request) => {
        const selected = joinRoles[request.requestId] ?? 'player';
        return (
          <View key={request.requestId} className="mb-2 rounded-xl bg-inset p-3">
            <View className="flex-row items-center">
              <Text className="flex-1 text-ink" numberOfLines={1}>{request.displayName ?? request.userId}</Text>
              <Pressable className="ml-3" onPress={() => void approve(request)}>
                <Text className="text-sm font-semibold text-safety">{t('teamAdmin.approve')}</Text>
              </Pressable>
              <Pressable className="ml-3" onPress={() => void decline(request)}>
                <Text className="text-sm font-semibold text-danger">{t('teamAdmin.decline')}</Text>
              </Pressable>
            </View>
            <View className="mt-2">
              <RolePicker
                roles={rolesFor(request)}
                value={selected}
                onChange={(role) => setJoinRoles((current) => ({ ...current, [request.requestId]: role }))}
              />
            </View>
          </View>
        );
      })}
    </>
  );
};
