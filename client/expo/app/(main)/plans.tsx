/**
 * Plan comparison and upgrade, for teams the person manages billing for.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { BillingInterval, PlanTier } from '@gameplan/types';
import { errorMessageKey } from '@/src/errors';
import { canBuyPlansHere, paysOwnPlan, planNameKey } from '@/src/plan';
import { RefreshableScroll } from '@/src/pull-refresh';
import { refreshBilling } from '@/src/queries/billing';
import { useApp } from '@/src/state';
import { BILLING_RETURN_LINK, openStripePage } from '@/src/stripe-page';
import { useTeamsWithPermission } from '@/src/team-access';
import { colors } from '@/src/theme';
import { Button, Chip, EqualChipRow, SubmitButton } from '@/src/ui';

/** Error sentences for plan purchases. */
const BILLING_ERRORS = {
  already_subscribed: 'errors.billing.alreadySubscribed',
  managed_by_organization: 'errors.billing.managedByOrganization',
  billing_not_configured: 'errors.billing.notConfigured',
} as const;

/** Tiers shown, cheapest first, with the feature lines each lists. */
const TIERS: { tier: PlanTier; features: string[] }[] = [
  { tier: 'free', features: ['schedule', 'calendarSync', 'photos2', 'practice5', 'ads'] },
  { tier: 'premium', features: ['everythingFree', 'video', 'photos50', 'practiceUnlimited', 'waivers', 'ai200', 'noAds'] },
  { tier: 'organization', features: ['everythingPremium', 'teams5', 'orgAdmin', 'announcements', 'shared', 'ai1000'] },
];

export default function PlansScreen() {
  const { t } = useTranslation();
  const { api } = useApp();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ teamId?: string }>();
  const billable = useTeamsWithPermission('manage_billing');
  const [teamId, setTeamId] = useState<string | undefined>(params.teamId);
  const [interval, setBillingInterval] = useState<BillingInterval>('year');
  const buyHere = canBuyPlansHere();

  useEffect(() => {
    if (teamId === undefined && billable[0] !== undefined) setTeamId(billable[0].teamId);
  }, [teamId, billable]);

  const team = billable.find((item) => item.teamId === teamId);

  const upgrade = async (): Promise<boolean> => {
    if (team === undefined) return false;
    const { url } = await api.createTeamCheckout(team.teamId, interval);
    await openStripePage(url, BILLING_RETURN_LINK);
    await refreshBilling(queryClient, team.teamId);
    return true;
  };

  const manage = async (): Promise<boolean> => {
    if (team === undefined) return false;
    const { url } = await api.createBillingPortal(team.teamId);
    await openStripePage(url, BILLING_RETURN_LINK);
    await refreshBilling(queryClient, team.teamId);
    return true;
  };

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <Text className="mb-1 text-lg font-semibold text-ink">{t('plans.title')}</Text>
      <Text className="mb-3 text-muted">{t('plans.subtitle')}</Text>

      {billable.length > 1 ? (
        <View className="mb-3 flex-row flex-wrap">
          {billable.map((item) => (
            <Chip key={item.teamId} label={item.name} selected={item.teamId === teamId} onPress={() => setTeamId(item.teamId)} />
          ))}
        </View>
      ) : null}

      {buyHere ? (
        <EqualChipRow className="mb-3">
          <Chip equal label={t('plans.monthly')} selected={interval === 'month'} onPress={() => setBillingInterval('month')} />
          <Chip equal label={t('plans.yearly')} selected={interval === 'year'} onPress={() => setBillingInterval('year')} />
        </EqualChipRow>
      ) : null}

      {TIERS.map(({ tier, features }) => (
        <View
          key={tier}
          className="mb-3 rounded-xl border bg-inset p-3"
          style={{ borderColor: team?.plan?.tier === tier ? colors.field : colors.line }}
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-ink">{t(planNameKey(tier))}</Text>
            {buyHere ? <Text className="text-ink">{t(`plans.price.${tier}.${interval}`)}</Text> : null}
          </View>
          {team?.plan?.tier === tier ? <Text className="mb-1 text-muted">{t('plans.current')}</Text> : null}
          {features.map((feature) => (
            <Text key={feature} className="text-ink">
              • {t(`plans.feature.${feature}`)}
            </Text>
          ))}
          {tier === 'organization' && api.user?.accountKind === 'adult' ? (
            <View className="mt-2">
              <Button label={t('plans.setUpOrganization')} tone="secondary" onPress={() => router.push('/orgs')} />
            </View>
          ) : null}
        </View>
      ))}

      {!buyHere ? <Text className="mb-6 text-muted">{t('plans.manageOnWeb')}</Text> : null}
      {buyHere && billable.length === 0 ? <Text className="mb-6 text-muted">{t('plans.noBillingTeams')}</Text> : null}
      {buyHere && team !== undefined ? (
        <View className="mb-8">
          {team.plan?.orgId !== undefined ? (
            <Text className="text-muted">{t('errors.billing.managedByOrganization')}</Text>
          ) : paysOwnPlan(team.plan) ? (
            <SubmitButton label={t('plans.manageBilling')} onPress={manage} loadedText="" />
          ) : (
            <SubmitButton
              label={t('plans.upgradeTeam', { team: team.name })}
              onPress={upgrade}
              loadedText=""
              message={(err) => t(errorMessageKey(err, 'errors.common.requestFailed', BILLING_ERRORS))}
            />
          )}
        </View>
      ) : null}
    </RefreshableScroll>
  );
}

