/**
 * Role invite links the caller can email, text, copy, and delete.
 *
 * GamePlan sends the email or text from its own address and number. Until a
 * channel is set up on the server, that channel opens the person's own mail or
 * messages app with the invite filled in instead.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { callerCanGrant, toE164Phone } from '@gameplan/rules';
import { TEAM_ROLES, type TeamInvite, type TeamRole } from '@gameplan/types';
import { createInviteMutation, deleteInviteMutation, invitesQuery, sendInviteMutation } from '@/src/queries/teams';
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
import { errorCode, errorMessageKey } from '@/src/errors';
import { openLink } from '@/src/open-link';
import { roleLabel } from '@/src/roles';
import { RolePicker } from '@/src/role-picker';
import { useApp } from '@/src/state';
import { TrashIcon } from '@/src/team-media';
import { Button, Field } from '@/src/ui';

/** Codes from the send endpoint that mean the server has no sender for the channel yet. */
const NOT_CONFIGURED = new Set(['email_not_configured', 'text_not_configured']);

/** Sentences for send failures that read the same for email and text. */
const SEND_ERRORS: Readonly<Record<string, string>> = {
  invite_send_limit: 'errors.teamAdmin.inviteSendLimit',
  recipient_opted_out: 'errors.teamAdmin.recipientOptedOut',
  text_country_unsupported: 'errors.teamAdmin.textCountryUnsupported',
};

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
  const { t, i18n } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const { data: invites = [] } = useQuery(invitesQuery(api, teamId));
  const createInvite = useMutation(createInviteMutation(api, queryClient, teamId));
  const send = useMutation(sendInviteMutation(api, queryClient, teamId));
  const remove = useMutation(deleteInviteMutation(api, queryClient, teamId));
  const [inviteRole, setInviteRole] = useState<TeamRole>('player');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState<'email' | 'text' | undefined>();
  const [sentNotice, setSentNotice] = useState<string | undefined>();
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

  /**
   * Opens the person's own mail or messages app with the invite filled in.
   *
   * @returns Whether the app opened.
   */
  const openOwnApp = async (channel: 'email' | 'text', recipient: string): Promise<boolean> => {
    const invite = await ensureInvite(inviteRole);
    const message = messageFor(invite);
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const url =
      channel === 'email'
        ? mailtoInviteUrl(recipient, message.subject, message.body)
        : smsInviteUrl(recipient, message.body, smsBodySeparator(userAgent));
    try {
      await openLink(url);
      return true;
    } catch {
      onError(t('errors.teamAdmin.sendInviteFailed'));
      return false;
    }
  };

  const sendInvite = async (channel: 'email' | 'text'): Promise<void> => {
    const recipient = channel === 'email' ? email.trim() : toE164Phone(phone);
    if (channel === 'email' && !isEmailAddress(email)) {
      onError(t('errors.teamAdmin.badInviteEmail'));
      return;
    }
    if (recipient === undefined) {
      onError(t('errors.teamAdmin.badInvitePhone'));
      return;
    }
    setSending(channel);
    setSentNotice(undefined);
    try {
      try {
        await send.mutateAsync({
          channel,
          to: recipient,
          role: inviteRole,
          locale: i18n.language?.startsWith('es') === true ? 'es' : 'en',
        });
        setSentNotice(
          t(channel === 'email' ? 'teamAdmin.inviteEmailed' : 'teamAdmin.inviteTexted', { to: recipient }),
        );
      } catch (err) {
        if (!NOT_CONFIGURED.has(errorCode(err))) throw err;
        if (!(await openOwnApp(channel, recipient))) return;
      }
      if (channel === 'email') setEmail('');
      else setPhone('');
    } catch (err) {
      const badRecipient = channel === 'email' ? 'errors.teamAdmin.badInviteEmail' : 'errors.teamAdmin.badInvitePhone';
      onError(t(errorMessageKey(err, 'errors.teamAdmin.inviteNotSent', { ...SEND_ERRORS, invalid_recipient: badRecipient })));
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
      {sentNotice === undefined ? null : (
        <Text className="mb-2 text-ink" accessibilityLiveRegion="polite">
          {sentNotice}
        </Text>
      )}
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
