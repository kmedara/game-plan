/**
 * Team admin: settings, roster, join requests, invites, and permissions.
 */

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  TEAM_ROLES,
  type JoinRequest,
  type RolePermissions,
  type TeamInvite,
  type TeamMember,
  type TeamRole,
} from '@gameplan/types';
import { JoinRequests } from '@/src/join-requests';
import { useApp } from '@/src/state';
import { TeamInvites } from '@/src/team-invites';
import { TeamPermissions } from '@/src/team-permissions';
import { TeamRoster } from '@/src/team-roster';
import { TeamColors } from '@/src/team-colors';
import { TeamChatBackground } from '@/src/team-chat-background';
import { TeamLogo } from '@/src/team-logo';
import { ErrorText, Field, SubmitButton, TimeZoneField } from '@/src/ui';

export default function TeamAdminScreen() {
  const { t } = useTranslation();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { api, setPreviewTheme } = useApp();
  const id = teamId ?? '';
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [accent, setAccent] = useState('');
  const [logoKey, setLogoKey] = useState<string | undefined>();
  const [chatBackgroundKey, setChatBackgroundKey] = useState<string | undefined>();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [roles, setRoles] = useState<RolePermissions[]>([]);
  const [callerRole, setCallerRole] = useState<TeamRole>('player');
  const [error, setError] = useState<string | undefined>();
  const [ready, setReady] = useState(false);

  const load = async (): Promise<void> => {
    const team = await api.getTeam(id);
    if (TEAM_ROLES.includes(team.role as TeamRole)) setCallerRole(team.role as TeamRole);
    setName(team.name);
    setTimeZone(team.timeZone);
    setPrimary(team.theme?.primary ?? '');
    setSecondary(team.theme?.secondary ?? '');
    setAccent(team.theme?.accent ?? '');
    setLogoKey(team.theme?.logoKey);
    setChatBackgroundKey(team.theme?.chatBackgroundKey);
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
    setReady(true);
  };

  useEffect(() => {
    if (id.length === 0) return;
    setReady(false);
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'));
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    const theme = {
      ...(primary.trim().length > 0 ? { primary: primary.trim() } : {}),
      ...(secondary.trim().length > 0 ? { secondary: secondary.trim() } : {}),
      ...(accent.trim().length > 0 ? { accent: accent.trim() } : {}),
    };
    setPreviewTheme(Object.keys(theme).length > 0 ? theme : undefined);
  }, [ready, primary, secondary, accent, setPreviewTheme]);

  useEffect(() => () => setPreviewTheme(undefined), [setPreviewTheme]);

  const saveSettings = async (): Promise<void> => {
    await api.updateTeam(id, {
      name: name.trim(),
      timeZone: timeZone.trim(),
      ...themePatch(primary, secondary, accent, logoKey, chatBackgroundKey),
    });
    await load();
  };

  return (
    <ScrollView className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      <Field label={t('teams.team')} value={name} onChangeText={setName} />
      <TimeZoneField label={t('teams.timeZone')} value={timeZone} onChange={setTimeZone} />
      <TeamColors
        primary={primary}
        secondary={secondary}
        accent={accent}
        onChange={(next) => {
          setPrimary(next.primary);
          setSecondary(next.secondary);
          setAccent(next.accent);
        }}
      />
      <TeamLogo
        teamId={id}
        name={name}
        theme={currentTheme(primary, secondary, accent, logoKey, chatBackgroundKey)}
        onSaved={(theme) => setLogoKey(theme?.logoKey)}
      />
      <TeamChatBackground
        teamId={id}
        theme={currentTheme(primary, secondary, accent, logoKey, chatBackgroundKey)}
        onSaved={(theme) => setChatBackgroundKey(theme?.chatBackgroundKey)}
      />
      <SubmitButton label={t('common.save')} onPress={saveSettings} />
      <TeamRoster teamId={id} members={members} />
      <JoinRequests
        teamId={id}
        requests={requests}
        roles={roles}
        callerRole={callerRole}
        reload={load}
        onError={setError}
      />
      <TeamInvites
        teamId={id}
        invites={invites}
        setInvites={setInvites}
        callerRole={callerRole}
        onError={setError}
      />
      <TeamPermissions teamId={id} roles={roles} setRoles={setRoles} members={members} />
    </ScrollView>
  );
};

const currentTheme = (
  primary: string,
  secondary: string,
  accent: string,
  logoKey: string | undefined,
  chatBackgroundKey: string | undefined,
): { primary?: string; secondary?: string; accent?: string; logoKey?: string; chatBackgroundKey?: string } | undefined => {
  const theme = {
    ...(primary.trim().length > 0 ? { primary: primary.trim() } : {}),
    ...(secondary.trim().length > 0 ? { secondary: secondary.trim() } : {}),
    ...(accent.trim().length > 0 ? { accent: accent.trim() } : {}),
    ...(logoKey !== undefined ? { logoKey } : {}),
    ...(chatBackgroundKey !== undefined ? { chatBackgroundKey } : {}),
  };
  return Object.keys(theme).length > 0 ? theme : undefined;
};

const themePatch = (
  primary: string,
  secondary: string,
  accent: string,
  logoKey: string | undefined,
  chatBackgroundKey: string | undefined,
): { theme?: { primary?: string; secondary?: string; accent?: string; logoKey?: string; chatBackgroundKey?: string } | null } => {
  const theme = currentTheme(primary, secondary, accent, logoKey, chatBackgroundKey);
  return theme !== undefined ? { theme } : { theme: null };
};
