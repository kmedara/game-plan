/**
 * What the signed-in person owes, for themselves and any children, with a Pay button.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MyDue } from '@gameplan/types';
import { errorMessageKey, queryError } from '@/src/errors';
import { formatMoney } from '@/src/money';
import { DueStatusLabel, isOwed, PAYMENT_ERRORS } from '@/src/payment-status';
import { myDuesQuery, refreshPayments } from '@/src/queries/payments';
import { RefreshableScroll } from '@/src/pull-refresh';
import { useApp } from '@/src/state';
import { openStripePage } from '@/src/stripe-page';
import { ErrorText, SubmitButton } from '@/src/ui';

export default function DuesScreen() {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ result?: string }>();
  const dues = useQuery(myDuesQuery(api));
  const [notice, setNotice] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (params.result === 'success') setNotice(t('dues.paymentReceived'));
  }, [params.result, t]);

  useEffect(() => {
    const failed = queryError(dues.error);
    if (failed !== undefined) setError(t(errorMessageKey(failed, 'errors.common.loadFailed')));
  }, [dues.error, t]);

  const pay = async (due: MyDue): Promise<boolean> => {
    setNotice(undefined);
    const { url } = await api.createCheckout(due.teamId, due.chargeId, due.memberId);
    const result = await openStripePage(url);
    if (result === 'success') setNotice(t('dues.paymentReceived'));
    await refreshPayments(queryClient, due.teamId);
    return true;
  };

  const owed = (dues.data ?? []).filter((due) => isOwed(due.status));
  const settled = (dues.data ?? []).filter((due) => !isOwed(due.status));

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('dues.title')}</Text>
      <ErrorText message={error} />
      {notice !== undefined ? <Text className="mb-2 text-ink">{notice}</Text> : null}
      {dues.data !== undefined && owed.length === 0 ? <Text className="mb-4 text-muted">{t('dues.allPaid')}</Text> : null}
      {owed.map((due) => (
        <DueCard key={`${due.teamId}:${due.chargeId}:${due.memberId}`} due={due} onPay={() => pay(due)} />
      ))}
      {settled.length > 0 ? <Text className="mb-2 mt-4 font-semibold text-ink">{t('dues.history')}</Text> : null}
      {settled.map((due) => (
        <DueCard key={`${due.teamId}:${due.chargeId}:${due.memberId}`} due={due} />
      ))}
    </RefreshableScroll>
  );
}

/** One due: what, for whom, how much, and when. */
const DueCard = ({ due, onPay }: { due: MyDue; onPay?: () => Promise<boolean> }) => {
  const { t, i18n } = useTranslation();
  const { api } = useApp();
  const forSomeoneElse = due.memberId !== api.user?.userId;
  return (
    <View className="mb-2 rounded-xl bg-inset p-3">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 font-semibold text-ink" numberOfLines={1}>
          {due.title}
        </Text>
        <Text className="font-semibold text-ink">{formatMoney(due.amountCents, due.currency, i18n.language)}</Text>
      </View>
      <Text className="text-muted">
        {[due.teamName, forSomeoneElse ? due.memberName : undefined].filter(Boolean).join(' · ')}
      </Text>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-muted">{t('payments.dueOn', { date: due.dueDate })}</Text>
        <DueStatusLabel status={due.status} />
      </View>
      {due.description !== undefined ? <Text className="mb-1 text-ink">{due.description}</Text> : null}
      {onPay !== undefined && due.canPay ? (
        <SubmitButton
          label={t('dues.pay')}
          onPress={onPay}
          loadedText=""
          message={(err) => t(errorMessageKey(err, 'errors.payments.checkoutFailed', PAYMENT_ERRORS))}
        />
      ) : null}
      {onPay !== undefined && !due.canPay ? <Text className="text-muted">{t('dues.guardianPays')}</Text> : null}
    </View>
  );
};
