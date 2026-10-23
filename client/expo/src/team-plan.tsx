/**
 * The team's plan on the team screen, with Upgrade or Manage billing for billing managers.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamPlan } from '@gameplan/types';
import { canBuyPlansHere, paysOwnPlan, planNameKey } from './plan';
import { refreshBilling } from './queries/billing';
import { useApp } from './state';
import { BILLING_RETURN_LINK, openStripePage } from './stripe-page';
import { Button, SubmitButton } from './ui';

export const TeamPlanSection = ({
  teamId,
  plan,
  canManage,
}: {
  teamId: string;
  plan: TeamPlan | undefined;
  canManage: boolean;
}) => {
  const { t, i18n } = useTranslation();
  const { api } = useApp();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tier = plan?.tier ?? 'free';
  const until =
    plan?.currentPeriodEnd === undefined
      ? undefined
      : new Date(plan.currentPeriodEnd).toLocaleDateString(i18n.language, { dateStyle: 'medium' });

  const portal = async (): Promise<boolean> => {
    const { url } = await api.createBillingPortal(teamId);
    await openStripePage(url, BILLING_RETURN_LINK);
    await refreshBilling(queryClient, teamId);
    return true;
  };

  return (
    <View className="mb-2 mt-4">
      <Text className="mb-1 text-lg font-semibold text-ink">{t('plans.teamPlan')}</Text>
      <Text className="mb-2 text-ink">
        {t(planNameKey(tier))}
        {until !== undefined && tier !== 'free'
          ? ` · ${t(plan?.cancelAtPeriodEnd === true || plan?.status === 'canceled' ? 'plans.endsOn' : 'plans.renewsOn', { date: until })}`
          : ''}
      </Text>
      {plan?.status === 'past_due' ? <Text className="mb-2 text-danger">{t('plans.pastDue')}</Text> : null}
      {canManage && plan?.orgId !== undefined ? <Text className="text-muted">{t('errors.billing.managedByOrganization')}</Text> : null}
      {canManage && plan?.orgId === undefined && canBuyPlansHere() ? (
        paysOwnPlan(plan) ? (
          <SubmitButton label={t('plans.manageBilling')} onPress={portal} loadedText="" />
        ) : (
          <Button
            label={t('plans.seePlans')}
            tone="secondary"
            onPress={() => router.push({ pathname: '/teams/[teamId]/plans', params: { teamId } })}
          />
        )
      ) : null}
      {canManage && plan?.orgId === undefined && !canBuyPlansHere() ? (
        <Text className="text-muted">{t('plans.manageOnWeb')}</Text>
      ) : null}
    </View>
  );
};
