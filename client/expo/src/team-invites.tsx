/**
 * Role invite links the caller can email, text, copy, and delete.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callerCanGrant } from '@gameplan/rules';
import { TEAM_ROLES, type TeamInvite, type TeamRole } from '@gameplan/types';
import { createInviteMutation, deleteInviteMutation, invitesQuery } from '@/src/queries/teams';
import {
  inviteMessageBody,
  invitePageUrl,
  inviteSiteOrigin,
  isEmailAddress,
  mailtoInviteUrl,
  smsBodySeparator,
  smsInviteUrl,
} from '@/src/invite-share';
import { config } from '@/src/config';
import { errorMessageKey } from '@/src/errors';
import { openLink } from '@/src/open-link';
import { toE164Phone } from '@/src/phone';
import { roleLabel } from '@/src/roles';
import { RolePicker } from '@/src/role-picker';
import { useApp } from '@/src/state';
import { TrashIcon } from '@/src/team-media';
import { Button, Field } from '@/src/ui';

export const TeamInvites = ({
  teamId,
  teamName,
  callerRole,
  onError,
}: {
  teamId: string;
  teamName: string;
  callerRole: TeamRole;
  onError: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const { data: invites = [] } = useQuery(invitesQuery(api, teamId));
  const createInvite = useMutation(createInviteMutation(api, queryClient, teamId));
  const remove = useMutation(deleteInviteMutation(api, queryClient, teamId));
  const [inviteRole, setInviteRole] = useState<TeamRole>('player');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState<'email' | 'text' | undefined>();
  const grantableRoles = TEAM_ROLES.filter((role) => callerCanGrant(callerRole, role));

  const ensureInvite = async (role: TeamRole): Promise<TeamInvite> => createInvite.mutateAsync(role);

  const messageFor = (invite: TeamInvite): { subject: string; body: string } => {
    const windowOrigin =
      typeof window === 'undefined' || window.location == null ? '' : window.location.origin;
    const origin = inviteSiteOrigin(windowOrigin, config.apiBaseUrl);
    const url = origin === undefined ? undefined : invitePageUrl(origin, invite.code);
    const role = t(roleLabel(invite.role));
    return {
      subject: t('teamAdmin.inviteSubject', { team: teamName }),
      body: inviteMessageBody({
        intro: t('teamAdmin.inviteMessage', { team: teamName, role }),
        codeLabel: t('teams.inviteCode'),
        code: invite.code,
        url,
      }),
    };
  };

  const copyInvite = async (role: TeamRole): Promise<void> => {
    try {
      const invite = await ensureInvite(role);
      await Clipboard.setStringAsync(invite.code);
    } catch (err) {
      onError(t(errorMessageKey(err, 'errors.teamAdmin.inviteFailed')));
    }
  };

  const sendInvite = async (channel: 'email' | 'text'): Promise<void> => {
    const recipient = channel === 'email' ? email.trim() : toE164Phone(phone);
    if (channel === 'email' && !isEmailAddress(email)) {
      onError(t('errors.teamAdmin.badInviteEmail'));
      return;
    }
    if (channel === 'text' && recipient === undefined) {
      onError(t('errors.teamAdmin.badInvitePhone'));
      return;
    }
    setSending(channel);
    try {
      const invite = await ensureInvite(inviteRole);
      const message = messageFor(invite);
      const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
      const url =
        channel === 'email'
          ? mailtoInviteUrl(email, message.subject, message.body)
          : smsInviteUrl(recipient ?? '', message.body, smsBodySeparator(userAgent));
      try {
        await openLink(url);
      } catch {
        onError(t('errors.teamAdmin.sendInviteFailed'));
        return;
      }
      if (channel === 'email') setEmail('');
      else setPhone('');
    } catch (err) {
      onError(t(errorMessageKey(err, 'errors.teamAdmin.inviteFailed')));
    } finally {
      setSending(undefined);
    }
  };

  const removeInvite = async (role: TeamRole): Promise<void> => {
    try {
      await remove.mutateAsync(role);
    } catch (err) {
      onError(t(errorMessageKey(err, 'errors.common.deleteFailed')));
    }
  };

  return (
    <>
      <Text className="mb-2 mt-2 text-lg font-semibold text-ink">{t('teamAdmin.inviteMembers')}</Text>
      <Text className="mb-2 text-muted">{t('teamAdmin.inviteHint')}</Text>
      <RolePicker roles={grantableRoles} value={inviteRole} onChange={setInviteRole} />
      <Field
        label={t('teamAdmin.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
      />
      <Button
        label={t('teamAdmin.emailInvite')}
        tone="secondary"
        busy={sending === 'email'}
        disabled={sending !== undefined}
        onPress={() => void sendInvite('email')}
      />
      <Field
        label={t('teamAdmin.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <Button
        label={t('teamAdmin.textInvite')}
        tone="secondary"
        busy={sending === 'text'}
        disabled={sending !== undefined}
        onPress={() => void sendInvite('text')}
      />
      <Button
        label={
          invites.some((invite) => invite.role === inviteRole)
            ? t('common.copyLink')
            : t('teamAdmin.createInviteLink')
        }
        onPress={() => void copyInvite(inviteRole)}
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
