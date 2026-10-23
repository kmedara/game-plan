/**
 * Card shown where a feature needs a paid plan. Opens the plans screen for that team.
 */

import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { canBuyPlansHere } from './plan';
import { Button } from './ui';

export const UpgradeCard = ({ teamId, message }: { teamId: string; message: string }) => {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View className="mb-3 rounded-xl border border-line bg-raised p-3">
      <Text className="mb-2 text-ink">{message}</Text>
      {canBuyPlansHere() ? (
        <Button
          label={t('plans.seePlans')}
          tone="secondary"
          onPress={() => router.push({ pathname: '/teams/[teamId]/plans', params: { teamId } })}
        />
      ) : (
        <Text className="text-muted">{t('plans.manageOnWeb')}</Text>
      )}
    </View>
  );
};
