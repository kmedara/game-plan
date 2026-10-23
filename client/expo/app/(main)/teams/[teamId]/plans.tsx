/**
 * Plan comparison and upgrade for one team (nested under team admin).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { BillingInterval, PlanTier } from '@gameplan/types';
import { errorMessageKey } from '@/src/errors';
import { canBuyPlansHere, paysOwnPlan, planNameKey } from '@/src/plan';
import { RefreshableScroll } from '@/src/pull-refresh';
import { refreshBilling } from '@/src/queries/billing';
import { teamQuery } from '@/src/queries/teams';
import { useApp, useBrandTeam } from '@/src/state';
import { BILLING_RETURN_LINK, openStripePage } from '@/src/stripe-page';
import { useTeamAccess } from '@/src/team-access';
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

export default function TeamPlansScreen() {
  const { t } = useTranslation();
  const { api, brand, teams } = useApp();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const id = teamId ?? '';
  const enabled = id.length > 0;
  useBrandTeam(enabled ? id : undefined);
  const summary = teams.find((item) => item.teamId === id);
  const access = useTeamAccess(summary);
  const loaded = useQuery({ ...teamQuery(api, id), enabled });
  const plan = loaded.data?.plan ?? summary?.plan;
  const name = loaded.data?.name ?? summary?.name ?? '';
  const [interval, setBillingInterval] = useState<BillingInterval>('year');
  const buyHere = canBuyPlansHere();
  const canManage = access.can('manage_billing');

  const upgrade = async (): Promise<boolean> => {
    const { url } = await api.createTeamCheckout(id, interval);
    await openStripePage(url, BILLING_RETURN_LINK);
    await refreshBilling(queryClient, id);
    return true;
  };

  const manage = async (): Promise<boolean> => {
    const { url } = await api.createBillingPortal(id);
    await openStripePage(url, BILLING_RETURN_LINK);
    await refreshBilling(queryClient, id);
    return true;
  };

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <Text className="mb-1 text-lg font-semibold text-ink">{t('plans.title')}</Text>
      <Text className="mb-3 text-muted">{name.length > 0 ? t('plans.subtitleTeam', { team: name }) : t('plans.subtitle')}</Text>

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
          style={{ borderColor: plan?.tier === tier ? brand.primary : colors.line }}
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-ink">{t(planNameKey(tier))}</Text>
            {buyHere ? <Text className="text-ink">{t(`plans.price.${tier}.${interval}`)}</Text> : null}
          </View>
          {plan?.tier === tier ? <Text className="mb-1 text-muted">{t('plans.current')}</Text> : null}
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
      {summary === undefined && enabled ? <Text className="mb-6 text-muted">{t('errors.common.loadFailed')}</Text> : null}
      {buyHere && canManage && summary !== undefined ? (
        <View className="mb-8">
          {plan?.orgId !== undefined ? (
            <Text className="text-muted">{t('errors.billing.managedByOrganization')}</Text>
          ) : paysOwnPlan(plan) ? (
            <SubmitButton label={t('plans.manageBilling')} onPress={manage} loadedText="" />
          ) : (
            <SubmitButton
              label={t('plans.upgradeTeam', { team: name })}
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
