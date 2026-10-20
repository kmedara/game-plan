/**
 * The team's organization on the team screen: which one it belongs to,
 * invitations to accept, and leaving.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from './errors';
import { appLocale } from './i18n';
import { formatMoney } from './money';
import { queryKeys } from './queries/keys';
import { teamOrgQuery } from './queries/orgs';
import { useApp } from './state';
import { Button, ErrorText } from './ui';

export const TeamOrgSection = ({ teamId, canManage }: { teamId: string; canManage: boolean }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const status = useQuery(teamOrgQuery(api, teamId));
  const [error, setError] = useState<string | undefined>();
  const [refunded, setRefunded] = useState<number | undefined>();
  const refresh = (): Promise<unknown> =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.teamOrg(teamId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.team(teamId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.teams, exact: true }),
    ]);
  const answer = useMutation({
    mutationFn: ({ orgId, accept }: { orgId: string; accept: boolean }) => api.answerOrgInvite(orgId, teamId, accept),
    onSuccess: (status) => {
      if (status.refundedCents !== undefined && status.refundedCents > 0) setRefunded(status.refundedCents);
      return refresh();
    },
  });
  const leave = useMutation({ mutationFn: (orgId: string) => api.removeOrgTeam(orgId, teamId), onSuccess: refresh });
  const report = (err: unknown): void =>
    setError(
      t(
        errorMessageKey(err, 'errors.common.requestFailed', {
          team_in_another_organization: 'errors.orgs.otherOrg',
          billing_not_configured: 'errors.billing.notConfigured',
        }),
      ),
    );

  const data = status.data;
  if (data === undefined || (data.org === undefined && data.invites.length === 0)) return null;

  return (
    <View className="mb-3 mt-2 rounded-xl border border-line p-3">
      <ErrorText message={error} />
      {data.org !== undefined ? (
        <>
          <Text className="text-ink">{t('orgs.partOf', { name: data.org.name })}</Text>
          {refunded !== undefined ? (
            <Text className="mt-1 text-muted">
              {t('orgs.refunded', { amount: formatMoney(refunded, 'usd', appLocale) })}
            </Text>
          ) : null}
          {canManage ? (
            <View className="mt-2">
              <Button
                label={t('orgs.leave')}
                tone="secondary"
                onPress={() => {
                  setError(undefined);
                  if (data.org !== undefined) void leave.mutateAsync(data.org.orgId).catch(report);
                }}
              />
            </View>
          ) : null}
        </>
      ) : null}
      {data.invites.map((invite) => (
        <View key={invite.orgId} className="mt-1">
          <Text className="mb-1 text-ink">{t('orgs.invitedBy', { name: invite.name })}</Text>
          {canManage ? (
            <>
              <Text className="mb-2 text-sm text-muted">{t('orgs.acceptNote')}</Text>
              <Button
                label={t('orgs.accept')}
                onPress={() => {
                  setError(undefined);
                  void answer.mutateAsync({ orgId: invite.orgId, accept: true }).catch(report);
                }}
              />
              <Button
                label={t('orgs.decline')}
                tone="secondary"
                onPress={() => {
                  setError(undefined);
                  void answer.mutateAsync({ orgId: invite.orgId, accept: false }).catch(report);
                }}
              />
            </>
          ) : (
            <Text className="text-sm text-muted">{t('orgs.askBillingManager')}</Text>
          )}
        </View>
      ))}
    </View>
  );
};
