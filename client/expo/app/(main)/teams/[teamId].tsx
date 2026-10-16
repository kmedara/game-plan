/**
 * Team admin: settings, roster, join requests, invites, and permissions.
 */

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { highestRole } from '@gameplan/rules';
import {
  type JoinRequest,
  type RolePermissions,
  type TeamInvite,
  type TeamMember,
  type TeamRole,
  type UpdateTeamBody,
} from '@gameplan/types';
import { JoinRequests } from '@/src/join-requests';
import { useApp } from '@/src/state';
import { TeamInvites } from '@/src/team-invites';
import { TeamPermissions } from '@/src/team-permissions';
import { TeamRoster } from '@/src/team-roster';
import { TeamColors } from '@/src/team-colors';
import { TeamChatBackground } from '@/src/team-chat-background';
import { TeamLogo } from '@/src/team-logo';
import type { ChatBackgroundOverlay } from '@/src/team-media';
import { heldRoles, memberHasPermission } from '@/src/roles';
import { ErrorText, Field, SubmitButton, TimeZoneField } from '@/src/ui';

export default function TeamAdminScreen() {
  const { t } = useTranslation();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { api, patchTeam, setPreviewTheme } = useApp();
  const id = teamId ?? '';
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [accent, setAccent] = useState('');
  const [logoKey, setLogoKey] = useState<string | undefined>();
  const [chatBackgroundKey, setChatBackgroundKey] = useState<string | undefined>();
  const [chatBackgroundOverlay, setChatBackgroundOverlay] = useState<ChatBackgroundOverlay>('dark');
  const [baseline, setBaseline] = useState<SettingsDraft | undefined>();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [roles, setRoles] = useState<RolePermissions[]>([]);
  const [callerRole, setCallerRole] = useState<TeamRole>('player');
  const [callerRoles, setCallerRoles] = useState<TeamRole[]>(['player']);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [ready, setReady] = useState(false);

  const remember = (team: { name: string; timeZone: string; theme?: Parameters<typeof draftFromTeam>[0]['theme'] }): void => {
    const next = draftFromTeam(team);
    setName(next.name);
    setTimeZone(next.timeZone);
    setPrimary(next.primary);
    setSecondary(next.secondary);
    setAccent(next.accent);
    setLogoKey(next.logoKey);
    setChatBackgroundKey(next.chatBackgroundKey);
    setChatBackgroundOverlay(next.chatBackgroundOverlay);
    setBaseline(next);
  };

  const load = async (): Promise<void> => {
    const team = await api.getTeam(id);
    const mine = heldRoles(team);
    setCallerRoles(mine);
    setCallerRole(highestRole(mine));
    remember(team);
    setMembers(await api.listMembers(id));
    let matrix: RolePermissions[] = [];
    try {
      const permissions = await api.getPermissions(id);
      matrix = permissions.roles;
      setRoles(matrix);
    } catch {
      setRoles([]);
    }
    setCanManageSettings(memberHasPermission(mine, matrix, 'manage_team_settings'));
    if (memberHasPermission(mine, matrix, 'approve_join_requests')) {
      try {
        setRequests(await api.listJoinRequests(id));
      } catch {
        setRequests([]);
      }
    } else {
      setRequests([]);
    }
    if (memberHasPermission(mine, matrix, 'invite_members')) {
      try {
        setInvites(await api.listInvites(id));
      } catch {
        setInvites([]);
      }
    } else {
      setInvites([]);
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

  const saveSettings = async (): Promise<boolean | void> => {
    if (baseline === undefined) return false;
    const body = settingsPatch(baseline, {
      name,
      timeZone,
      primary,
      secondary,
      accent,
      logoKey,
      chatBackgroundKey,
      chatBackgroundOverlay,
    });
    if (body === undefined) return false;
    const saved = await api.updateTeam(id, body);
    patchTeam(saved);
    remember(saved);
  };

  return (
    <ScrollView className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      {ready ? (
        <>
      {canManageSettings ? (
        <>
          <Field label={t('teams.team')} value={name} onChangeText={setName} />
          <TimeZoneField label={t('teams.timeZone')} value={timeZone} onChange={setTimeZone} />
          <View className="w-full flex-row items-start justify-around">
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
            theme={currentTheme(primary, secondary, accent, logoKey, chatBackgroundKey, chatBackgroundOverlay)}
            onSaved={(theme) => {
              setLogoKey(theme?.logoKey);
              setBaseline((current) => (current === undefined ? current : { ...current, logoKey: theme?.logoKey }));
            }}
          />
          </View>
          <TeamChatBackground
            teamId={id}
            theme={currentTheme(primary, secondary, accent, logoKey, chatBackgroundKey, chatBackgroundOverlay)}
            onOverlayChange={setChatBackgroundOverlay}
            onSaved={(theme) => {
              const chatBackgroundKey = theme?.chatBackgroundKey;
              const chatBackgroundOverlay = theme?.chatBackgroundOverlay ?? 'dark';
              setChatBackgroundKey(chatBackgroundKey);
              setChatBackgroundOverlay(chatBackgroundOverlay);
              setBaseline((current) =>
                current === undefined ? current : { ...current, chatBackgroundKey, chatBackgroundOverlay },
              );
            }}
          />
          <SubmitButton label={t('common.save')} onPress={saveSettings} />
        </>
      ) : null}
      <TeamRoster teamId={id} members={members} />
      {memberHasPermission(callerRoles, roles, 'approve_join_requests') ? (
        <JoinRequests
          teamId={id}
          requests={requests}
          roles={roles}
          callerRole={callerRole}
          reload={load}
          onError={setError}
        />
      ) : null}
      {memberHasPermission(callerRoles, roles, 'invite_members') ? (
        <TeamInvites
          teamId={id}
          teamName={name}
          invites={invites}
          setInvites={setInvites}
          callerRole={callerRole}
          onError={setError}
        />
      ) : null}
      <TeamPermissions teamId={id} roles={roles} setRoles={setRoles} members={members} />
        </>
      ) : null}
    </ScrollView>
  );
};

const currentTheme = (
  primary: string,
  secondary: string,
  accent: string,
  logoKey: string | undefined,
  chatBackgroundKey: string | undefined,
  chatBackgroundOverlay: ChatBackgroundOverlay,
): { primary?: string; secondary?: string; accent?: string; logoKey?: string; chatBackgroundKey?: string; chatBackgroundOverlay?: ChatBackgroundOverlay } | undefined => {
  const theme = {
    ...(primary.trim().length > 0 ? { primary: primary.trim() } : {}),
    ...(secondary.trim().length > 0 ? { secondary: secondary.trim() } : {}),
    ...(accent.trim().length > 0 ? { accent: accent.trim() } : {}),
    ...(logoKey !== undefined ? { logoKey } : {}),
    ...(chatBackgroundKey !== undefined ? { chatBackgroundKey, chatBackgroundOverlay } : {}),
  };
  return Object.keys(theme).length > 0 ? theme : undefined;
};

type SettingsDraft = {
  name: string;
  timeZone: string;
  primary: string;
  secondary: string;
  accent: string;
  logoKey: string | undefined;
  chatBackgroundKey: string | undefined;
  chatBackgroundOverlay: ChatBackgroundOverlay;
};

const draftFromTeam = (team: { name: string; timeZone: string; theme?: { primary?: string; secondary?: string; accent?: string; logoKey?: string; chatBackgroundKey?: string; chatBackgroundOverlay?: ChatBackgroundOverlay } }): SettingsDraft => ({
  name: team.name,
  timeZone: team.timeZone,
  primary: team.theme?.primary ?? '',
  secondary: team.theme?.secondary ?? '',
  accent: team.theme?.accent ?? '',
  logoKey: team.theme?.logoKey,
  chatBackgroundKey: team.theme?.chatBackgroundKey,
  chatBackgroundOverlay: team.theme?.chatBackgroundOverlay ?? 'dark',
});

const changedText = (saved: string, current: string): string | null | undefined => {
  const next = current.trim();
  if (next === saved) return undefined;
  return next.length === 0 ? null : next;
};

/** Fields that differ from the last saved team. An empty result means there is nothing to send. */
const settingsPatch = (saved: SettingsDraft, draft: SettingsDraft): UpdateTeamBody | undefined => {
  const theme: NonNullable<UpdateTeamBody['theme']> = {};
  const primary = changedText(saved.primary, draft.primary);
  const secondary = changedText(saved.secondary, draft.secondary);
  const accent = changedText(saved.accent, draft.accent);
  if (primary !== undefined) theme.primary = primary;
  if (secondary !== undefined) theme.secondary = secondary;
  if (accent !== undefined) theme.accent = accent;
  if (saved.logoKey !== draft.logoKey) theme.logoKey = draft.logoKey ?? null;
  if (saved.chatBackgroundKey !== draft.chatBackgroundKey) theme.chatBackgroundKey = draft.chatBackgroundKey ?? null;
  if (
    draft.chatBackgroundKey !== undefined &&
    saved.chatBackgroundOverlay !== draft.chatBackgroundOverlay
  ) {
    theme.chatBackgroundOverlay = draft.chatBackgroundOverlay;
  }
  if (draft.chatBackgroundKey === undefined && saved.chatBackgroundKey !== undefined) {
    theme.chatBackgroundOverlay = null;
  }

  const body: UpdateTeamBody = {};
  const name = draft.name.trim();
  const timeZone = draft.timeZone.trim();
  if (name !== saved.name) body.name = name;
  if (timeZone !== saved.timeZone) body.timeZone = timeZone;
  if (Object.keys(theme).length > 0) body.theme = theme;
  return Object.keys(body).length > 0 ? body : undefined;
};
