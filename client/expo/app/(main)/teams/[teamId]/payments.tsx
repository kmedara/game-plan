/**
 * Team payments for staff: Stripe setup, charges, and who has paid.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import Check from 'lucide-react-native/icons/check';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Charge, Due, TeamMember } from '@gameplan/types';
import { DayField } from '@/src/day-field';
import { errorMessageKey, queryError } from '@/src/errors';
import { formatMoney, parseAmountCents } from '@/src/money';
import { DueStatusLabel, PAYMENT_ERRORS } from '@/src/payment-status';
import {
  chargeQuery,
  chargesQuery,
  createChargeMutation,
  paymentAccountQuery,
  refreshPayments,
  updateDueMutation,
} from '@/src/queries/payments';
import { membersQuery } from '@/src/queries/teams';
import { RefreshableScroll } from '@/src/pull-refresh';
import { Sheet } from '@/src/sheet';
import { useApp, useBrandTeam } from '@/src/state';
import { openStripePage } from '@/src/stripe-page';
import { colors } from '@/src/theme';
import { Button, ErrorText, Field, SubmitButton } from '@/src/ui';

export default function TeamPaymentsScreen() {
  const { t } = useTranslation();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const id = teamId ?? '';
  const enabled = id.length > 0;
  useBrandTeam(enabled ? id : undefined);
  const { api } = useApp();
  const queryClient = useQueryClient();
  const account = useQuery({ ...paymentAccountQuery(api, id), enabled });
  const ready = account.data?.chargesEnabled === true;
  const charges = useQuery({ ...chargesQuery(api, id), enabled: enabled && ready });
  const members = useQuery({ ...membersQuery(api, id), enabled });
  const [creating, setCreating] = useState(false);
  const [openChargeId, setOpenChargeId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const failed = queryError(account.error) ?? queryError(charges.error);
    if (failed !== undefined) setError(t(errorMessageKey(failed, 'errors.common.loadFailed', PAYMENT_ERRORS)));
  }, [account.error, charges.error, t]);

  const setUpStripe = async (): Promise<void> => {
    const { url } = await api.createPaymentAccountLink(id);
    await openStripePage(url);
    await refreshPayments(queryClient, id);
  };

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('payments.title')}</Text>
      <ErrorText message={error} />
      {account.data !== undefined && !ready ? (
        <View className="mb-4 rounded-xl bg-inset p-3">
          <Text className="mb-2 text-ink">
            {account.data.connected ? t('payments.finishSetupHint') : t('payments.setupHint')}
          </Text>
          <SubmitButton
            label={account.data.connected ? t('payments.finishSetup') : t('payments.setUp')}
            onPress={setUpStripe}
            loadedText=""
            message={(err) => t(errorMessageKey(err, 'errors.common.requestFailed', PAYMENT_ERRORS))}
          />
        </View>
      ) : null}
      {ready ? (
        <>
          <Button label={t('payments.newCharge')} onPress={() => setCreating(true)} />
          {charges.data?.length === 0 ? <Text className="mb-4 text-muted">{t('payments.noCharges')}</Text> : null}
          {charges.data?.map((charge) => (
            <ChargeRow
              key={charge.chargeId}
              charge={charge}
              open={openChargeId === charge.chargeId}
              onToggle={() => setOpenChargeId((current) => (current === charge.chargeId ? undefined : charge.chargeId))}
            />
          ))}
        </>
      ) : null}
      <NewChargeSheet
        teamId={id}
        visible={creating}
        members={members.data ?? []}
        onClose={() => setCreating(false)}
      />
    </RefreshableScroll>
  );
}

/** One charge; tapping it shows each member's due. */
const ChargeRow = ({ charge, open, onToggle }: { charge: Charge; open: boolean; onToggle: () => void }) => {
  const { t, i18n } = useTranslation();
  return (
    <View className="mb-2 rounded-xl bg-inset p-3">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle}>
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 font-semibold text-ink" numberOfLines={1}>
            {charge.title}
          </Text>
          <Text className="font-semibold text-ink">{formatMoney(charge.amountCents, charge.currency, i18n.language)}</Text>
        </View>
        <Text className="text-muted">
          {t('payments.dueOn', { date: charge.dueDate })} ·{' '}
          {t('payments.settledCount', { settled: charge.totals.settled, members: charge.totals.members })}
        </Text>
      </Pressable>
      {open ? <ChargeDues teamId={charge.teamId} chargeId={charge.chargeId} /> : null}
    </View>
  );
};

/** Member dues on one charge, with the staff actions each status allows. */
const ChargeDues = ({ teamId, chargeId }: { teamId: string; chargeId: string }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const queryClient = useQueryClient();
  const detail = useQuery(chargeQuery(api, teamId, chargeId));
  const update = useMutation(updateDueMutation(api, queryClient, teamId, chargeId));
  const [error, setError] = useState<string | undefined>();

  const set = (memberId: string, status: 'unpaid' | 'paid_offline' | 'waived'): void => {
    setError(undefined);
    update.mutate(
      { memberId, status },
      { onError: (err) => setError(t(errorMessageKey(err, 'errors.common.saveFailed', PAYMENT_ERRORS))) },
    );
  };

  if (detail.data === undefined) return <Text className="mt-2 text-muted">{t('common.loading')}</Text>;
  return (
    <View className="mt-2 border-t border-line pt-2">
      <ErrorText message={error} />
      {detail.data.dues.map((due) => (
        <View key={due.memberId} className="mb-2">
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 text-ink">{due.memberName ?? t('common.unknownPerson')}</Text>
            <DueStatusLabel status={due.status} />
          </View>
          <DueActions due={due} onSet={(status) => set(due.memberId, status)} />
        </View>
      ))}
    </View>
  );
};

/** Staff shortcuts for one due. A Stripe payment is refunded in Stripe, not here. */
const DueActions = ({ due, onSet }: { due: Due; onSet: (status: 'unpaid' | 'paid_offline' | 'waived') => void }) => {
  const { t } = useTranslation();
  const { brand } = useApp();
  const link = (label: string, status: 'unpaid' | 'paid_offline' | 'waived') => (
    <Pressable key={status} accessibilityRole="button" className="mr-4 py-1" onPress={() => onSet(status)}>
      <Text style={{ color: brand.secondary }}>{label}</Text>
    </Pressable>
  );
  if (due.status === 'paid') return null;
  if (due.status === 'paid_offline' || due.status === 'waived') {
    return <View className="flex-row">{link(t('payments.undo'), 'unpaid')}</View>;
  }
  return (
    <View className="flex-row">
      {link(t('payments.markPaid'), 'paid_offline')}
      {link(t('payments.waive'), 'waived')}
    </View>
  );
};

/** Form to charge some or all members. */
const NewChargeSheet = ({
  teamId,
  visible,
  members,
  onClose,
}: {
  teamId: string;
  visible: boolean;
  members: TeamMember[];
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const { api, brand } = useApp();
  const queryClient = useQueryClient();
  const create = useMutation(createChargeMutation(api, queryClient, teamId));
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (visible) setSelected(new Set(members.map((member) => member.userId)));
  }, [visible, members]);

  const toggle = (userId: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const submit = async (): Promise<boolean> => {
    const amountCents = parseAmountCents(amount);
    if (title.trim().length === 0) throw new Error('title_required');
    if (amountCents === undefined) throw new Error('invalid_amount');
    const [first, ...rest] = [...selected];
    if (first === undefined) throw new Error('no_members');
    await create.mutateAsync({
      title: title.trim(),
      amountCents,
      currency: 'usd',
      dueDate,
      memberIds: [first, ...rest],
    });
    setTitle('');
    setAmount('');
    onClose();
    return true;
  };

  return (
    <Sheet visible={visible} title={t('payments.newCharge')} closeLabel={t('common.cancel')} onClose={onClose}>
      <Field label={t('payments.chargeTitle')} value={title} onChangeText={setTitle} placeholder={t('payments.chargeTitleHint')} />
      <Field label={t('payments.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="45.00" />
      <Text className="mb-1 text-sm text-muted">{t('payments.dueDate')}</Text>
      <View className="mb-3">
        <DayField value={dueDate} onChange={setDueDate} />
      </View>
      <Text className="mb-1 text-sm text-muted">{t('payments.who', { count: selected.size })}</Text>
      {members.map((member) => {
        const checked = selected.has(member.userId);
        return (
          <Pressable
            key={member.userId}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            className="min-h-9 flex-row items-center"
            onPress={() => toggle(member.userId)}
          >
            <View
              className="mr-3 h-6 w-6 items-center justify-center rounded-md border-2"
              style={{ borderColor: checked ? brand.primary : colors.line, backgroundColor: checked ? brand.primary : colors.paper }}
            >
              {checked ? <Check size={16} color={brand.onPrimary} strokeWidth={3} /> : null}
            </View>
            <Text className="text-base text-ink">{member.displayName ?? member.userId}</Text>
          </Pressable>
        );
      })}
      <View className="mt-4">
        <SubmitButton
          label={t('payments.sendCharge')}
          onPress={submit}
          loadedText=""
          message={(err) =>
            t(
              errorMessageKey(err, 'errors.common.saveFailed', {
                ...PAYMENT_ERRORS,
                title_required: 'errors.payments.titleRequired',
                invalid_amount: 'errors.payments.invalidAmount',
                no_members: 'errors.payments.noMembers',
              }),
            )
          }
        />
      </View>
    </Sheet>
  );
};
