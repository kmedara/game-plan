/**
 * Team admin: settings, plan, payments link, roster, join requests, invites, and permissions.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canWithRoles, highestRole, permissionMatrix, rolesFromMembership } from '@gameplan/rules';
import {
  type RolePermissions,
  type TeamPermission,
  type TeamRole,
  type TeamTheme,
  type UpdateTeamBody,
} from '@gameplan/types';
import { errorMessageKey, queryError } from '@/src/errors';
import { RefreshableScroll } from '@/src/pull-refresh';
import { JoinRequests } from '@/src/join-requests';
import { membersQuery, permissionsQuery, teamQuery, updateTeamMutation } from '@/src/queries/teams';
import { useApp, useBrandTeam } from '@/src/state';
import { TeamInvites } from '@/src/team-invites';
import { TeamPermissions } from '@/src/team-permissions';
import { TeamOrgSection } from '@/src/team-org';
import { TeamPlanSection } from '@/src/team-plan';
import { TeamRoster } from '@/src/team-roster';
import { TeamColors } from '@/src/team-colors';
import { TeamChatBackground } from '@/src/team-chat-background';
import { TeamLogo } from '@/src/team-logo';
import type { ChatBackgroundOverlay } from '@/src/team-media';
import { Button, ErrorText, Field, TimeZoneField } from '@/src/ui';

export default function TeamAdminScreen() {
  const { t } = useTranslation();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const router = useRouter();
  const { api, setPreviewTheme } = useApp();
  const queryClient = useQueryClient();
  const id = teamId ?? '';
  useBrandTeam(id.length > 0 ? id : undefined);
  const enabled = id.length > 0;
  const teamLoaded = useQuery({ ...teamQuery(api, id), enabled });
  const membersLoaded = useQuery({ ...membersQuery(api, id), enabled });
  const permissionsLoaded = useQuery({ ...permissionsQuery(api, id), enabled });
  const saveTeam = useMutation(updateTeamMutation(api, queryClient, id));
  const [draft, setDraft] = useState<SettingsDraft | undefined>();
  const [baseline, setBaseline] = useState<SettingsDraft | undefined>();
  const [roles, setRoles] = useState<RolePermissions[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const members = membersLoaded.data ?? [];
  const savedRoles = permissionsLoaded.data ?? [];
  const roleRows = roles ?? savedRoles;
  const callerRoles: TeamRole[] = teamLoaded.data === undefined ? ['player'] : rolesFromMembership(teamLoaded.data);
  const callerRole = highestRole(callerRoles);
  const can = (permission: TeamPermission): boolean => canWithRoles(callerRoles, permissionMatrix(roleRows), permission);
  const ready =
    enabled &&
    teamLoaded.data !== undefined &&
    membersLoaded.data !== undefined &&
    (permissionsLoaded.data !== undefined || permissionsLoaded.isError);

  const remember = (team: { name: string; timeZone: string; sport?: string; theme?: TeamTheme }): void => {
    const next = draftFromTeam(team);
    setDraft(next);
    setBaseline(next);
  };

  const edit = (patch: Partial<SettingsDraft>): void => {
    setDraft((current) => (current === undefined ? current : { ...current, ...patch }));
  };

  /** Applies fields that were already saved, so they no longer count as unsaved edits. */
  const adopt = (patch: Partial<SettingsDraft>): void => {
    edit(patch);
    setBaseline((current) => (current === undefined ? current : { ...current, ...patch }));
  };

  useEffect(() => {
    setDraft(undefined);
    setBaseline(undefined);
    setRoles(undefined);
  }, [id]);

  useEffect(() => {
    if (teamLoaded.data !== undefined && draft === undefined) remember(teamLoaded.data);
  }, [teamLoaded.data, draft]);

  useEffect(() => {
    if (permissionsLoaded.data !== undefined && roles === undefined) setRoles(permissionsLoaded.data);
  }, [permissionsLoaded.data, roles]);

  useEffect(() => {
    const loadError = queryError(teamLoaded.error) ?? queryError(membersLoaded.error);
    if (loadError !== undefined) setError(t(errorMessageKey(loadError, 'errors.common.loadFailed')));
  }, [teamLoaded.error, membersLoaded.error, t]);

  const colors = draft === undefined ? undefined : colorTheme(draft);
  useEffect(() => {
    if (!ready) return;
    setPreviewTheme(colors);
  }, [ready, colors?.primary, colors?.secondary, colors?.accent, setPreviewTheme]);

  useEffect(() => () => setPreviewTheme(undefined), [setPreviewTheme]);

  const reportSaveError = (err: unknown): void => {
    setError(t(errorMessageKey(err, 'errors.common.saveFailed')));
  };

  const saveText = (field: 'name' | 'timeZone' | 'sport') => async (): Promise<void> => {
    if (baseline === undefined || draft === undefined) return;
    const value = draft[field].trim();
    if (value === baseline[field]) return;
    if (field !== 'sport' && value.length === 0) return;
    setError(undefined);
    try {
      const saved = await saveTeam.mutateAsync(field === 'sport' ? { sport: value.length === 0 ? null : value } : { [field]: value });
      adopt({ [field]: saved[field] ?? '' });
    } catch (err) {
      reportSaveError(err);
    }
  };

  const saveOverlay = (choice: ChatBackgroundOverlay): void => {
    if (baseline === undefined || choice === baseline.chatBackgroundOverlay) return;
    const previous = baseline.chatBackgroundOverlay;
    edit({ chatBackgroundOverlay: choice });
    setError(undefined);
    void saveTeam
      .mutateAsync({ theme: { chatBackgroundOverlay: choice } })
      .then((saved) => adopt({ chatBackgroundOverlay: saved.theme?.chatBackgroundOverlay ?? choice }))
      .catch((err: unknown) => {
        edit({ chatBackgroundOverlay: previous });
        reportSaveError(err);
      });
  };

  useEffect(() => {
    if (baseline === undefined || draft === undefined) return;
    const theme = colorPatch(baseline, draft);
    if (theme === undefined) return;
    const sent = { primary: draft.primary, secondary: draft.secondary, accent: draft.accent };
    const handle = setTimeout(() => {
      void saveTeam
        .mutateAsync({ theme })
        .then((team) => {
          const next = {
            primary: team.theme?.primary ?? '',
            secondary: team.theme?.secondary ?? '',
            accent: team.theme?.accent ?? '',
          };
          setBaseline((current) => (current === undefined ? current : { ...current, ...next }));
          setDraft((current) => {
            if (current === undefined) return current;
            if (current.primary !== sent.primary || current.secondary !== sent.secondary || current.accent !== sent.accent) {
              return current;
            }
            return { ...current, ...next };
          });
        })
        .catch((err: unknown) => reportSaveError(err));
    }, 300);
    return () => clearTimeout(handle);
  }, [baseline?.primary, baseline?.secondary, baseline?.accent, draft?.primary, draft?.secondary, draft?.accent]);

  const theme = draft === undefined ? undefined : themeFromDraft(draft);
  const nameChanged =
    baseline !== undefined &&
    draft !== undefined &&
    draft.name.trim() !== baseline.name &&
    draft.name.trim().length > 0;
  const sportChanged = baseline !== undefined && draft !== undefined && draft.sport.trim() !== baseline.sport;
  const timeZoneChanged =
    baseline !== undefined &&
    draft !== undefined &&
    draft.timeZone.trim() !== baseline.timeZone &&
    draft.timeZone.trim().length > 0;

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      {ready && draft !== undefined ? (
        <>
          {can('manage_team_settings') ? (
            <>
              <Field
                label={t('teams.team')}
                value={draft.name}
                onChangeText={(name) => edit({ name })}
                onSave={nameChanged ? saveText('name') : undefined}
              />
              <Field
                label={t('teamAdmin.sport')}
                value={draft.sport}
                onChangeText={(sport) => edit({ sport })}
                onSave={sportChanged ? saveText('sport') : undefined}
              />
              <TimeZoneField
                label={t('teams.timeZone')}
                value={draft.timeZone}
                onChange={(timeZone) => edit({ timeZone })}
                onSave={timeZoneChanged ? saveText('timeZone') : undefined}
              />
              <View className="w-full flex-row items-start justify-around">
                <TeamColors primary={draft.primary} secondary={draft.secondary} accent={draft.accent} onChange={edit} />
                <TeamLogo
                  teamId={id}
                  name={draft.name}
                  theme={theme}
                  onSaved={(saved) => adopt({ logoKey: saved?.logoKey })}
                />
              </View>
              <TeamChatBackground
                teamId={id}
                theme={theme}
                onOverlayChange={saveOverlay}
                onSaved={(saved) =>
                  adopt({
                    chatBackgroundKey: saved?.chatBackgroundKey,
                    chatBackgroundOverlay: saved?.chatBackgroundOverlay ?? 'dark',
                  })
                }
              />
            </>
          ) : null}
          <TeamPlanSection teamId={id} plan={teamLoaded.data?.plan} canManage={can('manage_billing')} />
          <TeamOrgSection teamId={id} canManage={can('manage_billing')} />
          {can('manage_payments') ? (
            <Button
              label={t('payments.title')}
              tone="secondary"
              onPress={() => router.push({ pathname: '/teams/[teamId]/payments', params: { teamId: id } })}
            />
          ) : null}
          <TeamRoster teamId={id} members={members} />
          {can('approve_join_requests') ? (
            <JoinRequests teamId={id} roles={roleRows} callerRole={callerRole} onError={setError} />
          ) : null}
          {can('invite_members') ? (
            <TeamInvites teamId={id} teamName={draft.name} callerRole={callerRole} onError={setError} />
          ) : null}
          <TeamPermissions
            teamId={id}
            roles={roleRows}
            setRoles={(update) =>
              setRoles((current) => {
                const rows = current ?? savedRoles;
                return typeof update === 'function' ? update(rows) : update;
              })
            }
            members={members}
          />
        </>
      ) : null}
    </RefreshableScroll>
  );
}

type SettingsDraft = {
  name: string;
  timeZone: string;
  sport: string;
  primary: string;
  secondary: string;
  accent: string;
  logoKey: string | undefined;
  chatBackgroundKey: string | undefined;
  chatBackgroundOverlay: ChatBackgroundOverlay;
};

const draftFromTeam = (team: { name: string; timeZone: string; sport?: string; theme?: TeamTheme }): SettingsDraft => ({
  name: team.name,
  timeZone: team.timeZone,
  sport: team.sport ?? '',
  primary: team.theme?.primary ?? '',
  secondary: team.theme?.secondary ?? '',
  accent: team.theme?.accent ?? '',
  logoKey: team.theme?.logoKey,
  chatBackgroundKey: team.theme?.chatBackgroundKey,
  chatBackgroundOverlay: team.theme?.chatBackgroundOverlay ?? 'dark',
});

/** The draft's non-blank colors, or `undefined` when none are set. */
const colorTheme = (draft: SettingsDraft): TeamTheme | undefined => {
  const theme = {
    ...(draft.primary.trim().length > 0 ? { primary: draft.primary.trim() } : {}),
    ...(draft.secondary.trim().length > 0 ? { secondary: draft.secondary.trim() } : {}),
    ...(draft.accent.trim().length > 0 ? { accent: draft.accent.trim() } : {}),
  };
  return Object.keys(theme).length > 0 ? theme : undefined;
};

/** The theme the draft describes, for the image settings. */
const themeFromDraft = (draft: SettingsDraft): TeamTheme | undefined => {
  const theme: TeamTheme = {
    ...colorTheme(draft),
    ...(draft.logoKey !== undefined ? { logoKey: draft.logoKey } : {}),
    ...(draft.chatBackgroundKey !== undefined
      ? { chatBackgroundKey: draft.chatBackgroundKey, chatBackgroundOverlay: draft.chatBackgroundOverlay }
      : {}),
  };
  return Object.keys(theme).length > 0 ? theme : undefined;
};

const changedText = (saved: string, current: string): string | null | undefined => {
  const next = current.trim();
  if (next === saved) return undefined;
  return next.length === 0 ? null : next;
};

/** Color fields that differ from the last saved team. */
const colorPatch = (saved: SettingsDraft, draft: SettingsDraft): UpdateTeamBody['theme'] | undefined => {
  const theme: NonNullable<UpdateTeamBody['theme']> = {};
  const primary = changedText(saved.primary, draft.primary);
  const secondary = changedText(saved.secondary, draft.secondary);
  const accent = changedText(saved.accent, draft.accent);
  if (primary !== undefined) theme.primary = primary;
  if (secondary !== undefined) theme.secondary = secondary;
  if (accent !== undefined) theme.accent = accent;
  return Object.keys(theme).length > 0 ? theme : undefined;
};
