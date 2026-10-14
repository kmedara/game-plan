/**
 * Team admin: settings, roster, join requests, invites, and permissions.
 */

import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callerCanGrant, roleAllowedForAccount } from '@gameplan/rules';
import {
  TEAM_PERMISSIONS,
  TEAM_ROLES,
  type JoinRequest,
  type RolePermissions,
  type TeamInvite,
  type TeamMember,
  type TeamRole,
} from '@gameplan/types';
import { joinRequestMessage, roleLabel } from '@/src/roles';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field } from '@/src/ui';

export default function TeamAdminScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { api } = useApp();
  const id = teamId ?? '';
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [primary, setPrimary] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [roles, setRoles] = useState<RolePermissions[]>([]);
  const [joinRoles, setJoinRoles] = useState<Record<string, TeamRole>>({});
  const [callerRole, setCallerRole] = useState<TeamRole>('player');
  const [error, setError] = useState<string | undefined>();

  const load = async (): Promise<void> => {
    const team = await api.getTeam(id);
    if (TEAM_ROLES.includes(team.role as TeamRole)) setCallerRole(team.role as TeamRole);
    setName(team.name);
    setTimeZone(team.timeZone);
    setPrimary(team.theme?.primary ?? '');
    setMembers(await api.listMembers(id));
    try {
      setRequests(await api.listJoinRequests(id));
    } catch {
      setRequests([]);
    }
    try {
      setInvites(await api.listInvites(id));
    } catch {
      setInvites([]);
    }
    try {
      const permissions = await api.getPermissions(id);
      setRoles(permissions.roles);
    } catch {
      setRoles([]);
    }
  };

  useEffect(() => {
    if (id.length === 0) return;
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'));
  }, [id]);

  const saveSettings = async (): Promise<void> => {
    setError(undefined);
    try {
      await api.updateTeam(id, {
        name: name.trim(),
        timeZone: timeZone.trim(),
        ...(primary.trim().length > 0 ? { theme: { primary: primary.trim() } } : {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    }
  };

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
      await api.approveJoinRequest(id, request.requestId, role);
      await load();
    } catch (err) {
      setError(t(joinRequestMessage(err)));
    }
  };

  const decline = async (request: JoinRequest): Promise<void> => {
    try {
      await api.rejectJoinRequest(id, request.requestId);
      await load();
    } catch (err) {
      setError(t(joinRequestMessage(err)));
    }
  };

  const createInvite = async (): Promise<void> => {
    try {
      const invite = await api.createInvite(id, 'player');
      setInvites((current) => [invite, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    }
  };

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
    if (blocked) {
      setError('minor_cannot_hold_manage_permissions');
      return;
    }
    try {
      const saved = await api.putPermissions(id, roles);
      setRoles(saved.roles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    }
  };

  return (
    <ScrollView className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      <Field label={t('teams.team')} value={name} onChangeText={setName} />
      <Field label={t('teams.timeZone')} value={timeZone} onChangeText={setTimeZone} />
      <Field label={t('teamAdmin.primaryColor')} value={primary} onChangeText={setPrimary} placeholder="#0f766e" />
      <Button label={t('common.save')} onPress={() => void saveSettings()} />

      <Text className="mb-2 mt-4 text-lg font-semibold">{t('teamAdmin.roster')}</Text>
      {members.map((member) => (
        <Pressable
          key={member.userId}
          className="mb-2 rounded bg-white p-3"
          onPress={() => router.push(`/teams/${id}/members/${member.userId}`)}
        >
          <Text>{member.displayName ?? member.userId}</Text>
          <Text className="text-slate-500">{t(roleLabel(member.role))}</Text>
        </Pressable>
      ))}

      <Text className="mb-2 mt-4 text-lg font-semibold">{t('teamAdmin.joinRequests')}</Text>
      {requests.map((request) => (
        <View key={request.requestId} className="mb-3 rounded bg-white p-3">
          <Text>{request.displayName ?? request.userId}</Text>
          <View className="my-2 flex-row flex-wrap">
            {rolesFor(request).map((role) => (
              <Pressable key={role} className="mr-2" onPress={() => setJoinRoles((current) => ({ ...current, [request.requestId]: role }))}>
                <Text className={(joinRoles[request.requestId] ?? 'player') === role ? 'font-bold' : ''}>{t(roleLabel(role))}</Text>
              </Pressable>
            ))}
          </View>
          <Button label={t('teamAdmin.approve')} onPress={() => void approve(request)} />
          <Button label={t('teamAdmin.decline')} onPress={() => void decline(request)} color="#b91c1c" />
        </View>
      ))}

      <Text className="mb-2 mt-2 text-lg font-semibold">{t('teamAdmin.inviteMembers')}</Text>
      <Button label={t('teamAdmin.createInviteLink')} onPress={() => void createInvite()} />
      {invites.map((invite) => (
        <Pressable
          key={invite.code}
          className="mb-2 rounded bg-white p-3"
          onPress={() => void Clipboard.setStringAsync(`${invite.code}`)}
        >
          <Text>{invite.code}</Text>
          <Text className="text-slate-500">{t('common.copyLink')}</Text>
        </Pressable>
      ))}

      {roles.length > 0 ? (
        <View className="mb-8 mt-4">
          <Text className="mb-2 text-lg font-semibold">{t('teamAdmin.permissions')}</Text>
          {roles.map((row) => (
            <View key={row.role} className="mb-3">
              <Text className="font-semibold">{t(roleLabel(row.role))}</Text>
              {TEAM_PERMISSIONS.map((permission) => {
                const checked = row.permissions.includes(permission);
                return (
                  <Pressable key={permission} onPress={() => toggle(row.role, permission, !checked)}>
                    <Text>{checked ? '☑' : '☐'} {permission}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <Button label={t('common.save')} onPress={() => void savePermissions()} />
        </View>
      ) : null}
    </ScrollView>
  );
}
