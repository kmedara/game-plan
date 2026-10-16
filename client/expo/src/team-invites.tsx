/**
 * Role invite links the caller can email, text, copy, and delete.
 */

import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callerCanGrant } from '@gameplan/rules';
import { TEAM_ROLES, type TeamInvite, type TeamRole } from '@gameplan/types';
import {
  inviteMessageBody,
  invitePageUrl,
  isEmailAddress,
  mailtoInviteUrl,
  smsBodySeparator,
  smsInviteUrl,
} from '@/src/invite-share';
import { toE164Phone } from '@/src/phone';
import { roleLabel } from '@/src/roles';
import { RolePicker } from '@/src/role-picker';
import { useApp } from '@/src/state';
import { TrashIcon } from '@/src/team-media';
import { Button, Field } from '@/src/ui';

export const TeamInvites = ({
  teamId,
  teamName,
  invites,
  setInvites,
  callerRole,
  onError,
}: {
  teamId: string;
  teamName: string;
  invites: TeamInvite[];
  setInvites: (update: (current: TeamInvite[]) => TeamInvite[]) => void;
  callerRole: TeamRole;
  onError: (message: string) => void;
}) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [inviteRole, setInviteRole] = useState<TeamRole>('player');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState<'email' | 'text' | undefined>();
  const grantableRoles = TEAM_ROLES.filter((role) => callerCanGrant(callerRole, role));

  const rememberInvite = (invite: TeamInvite): void => {
    setInvites((current) => {
      const rest = current.filter((item) => item.role !== invite.role);
      return [invite, ...rest];
    });
  };

  const ensureInvite = async (role: TeamRole): Promise<TeamInvite> => {
    const invite = await api.createInvite(teamId, role);
    rememberInvite(invite);
    return invite;
  };

  const messageFor = (invite: TeamInvite): { subject: string; body: string } => {
    const origin =
      typeof window === 'undefined' || window.location == null ? '' : window.location.origin;
    const url = origin.length > 0 ? invitePageUrl(origin, invite.code) : undefined;
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

  const createInvite = async (role: TeamRole): Promise<void> => {
    try {
      const invite = await ensureInvite(role);
      await Clipboard.setStringAsync(invite.code);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'request_failed');
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
        await Linking.openURL(url);
      } catch {
        onError(t('errors.teamAdmin.sendInviteFailed'));
        return;
      }
      if (channel === 'email') setEmail('');
      else setPhone('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'request_failed');
    } finally {
      setSending(undefined);
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
