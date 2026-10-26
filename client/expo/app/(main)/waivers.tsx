/**
 * Waivers the signed-in person signs, for themselves and any children, across every team.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MyWaiver } from '@gameplan/types';
import { errorMessageKey, queryError } from '@/src/errors';
import { myWaiversQuery } from '@/src/queries/waivers';
import { RefreshableScroll } from '@/src/pull-refresh';
import { useApp } from '@/src/state';
import { Button, ErrorText } from '@/src/ui';
import { SignWaiverSheet, SignatureSheet, WaiverStatusLabel } from '@/src/waivers';

export default function WaiversScreen() {
  const { t } = useTranslation();
  const { api } = useApp();
  const waivers = useQuery(myWaiversQuery(api));
  const [signing, setSigning] = useState<MyWaiver | undefined>();
  const [viewing, setViewing] = useState<MyWaiver | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const failed = queryError(waivers.error);
    if (failed !== undefined) setError(t(errorMessageKey(failed, 'errors.common.loadFailed')));
  }, [waivers.error, t]);

  const open = (waivers.data ?? []).filter((waiver) => waiver.status !== 'signed');
  const signed = (waivers.data ?? []).filter((waiver) => waiver.status === 'signed');

  return (
    <RefreshableScroll className="flex-1 px-4 pt-4">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('waivers.title')}</Text>
      <ErrorText message={error} />
      {waivers.data !== undefined && open.length === 0 ? (
        <Text className="mb-4 text-muted">{t('waivers.allSigned')}</Text>
      ) : null}
      {open.map((waiver) => (
        <WaiverCard key={`${waiver.teamId}:${waiver.waiverId}:${waiver.memberId}`} waiver={waiver} onSign={() => setSigning(waiver)} onView={() => setViewing(waiver)} />
      ))}
      {signed.length > 0 ? <Text className="mb-2 mt-4 font-semibold text-ink">{t('waivers.history')}</Text> : null}
      {signed.map((waiver) => (
        <WaiverCard key={`${waiver.teamId}:${waiver.waiverId}:${waiver.memberId}`} waiver={waiver} onView={() => setViewing(waiver)} />
      ))}
      <SignWaiverSheet waiver={signing} onClose={() => setSigning(undefined)} />
      <SignatureSheet target={viewing} onClose={() => setViewing(undefined)} />
    </RefreshableScroll>
  );
}

/** One waiver: what, for whom, which team, and when it is due. */
const WaiverCard = ({ waiver, onSign, onView }: { waiver: MyWaiver; onSign?: () => void; onView: () => void }) => {
  const { t, i18n } = useTranslation();
  const { api } = useApp();
  const forSomeoneElse = waiver.memberId !== api.user?.userId;
  return (
    <View className="mb-2 rounded-xl bg-inset p-3">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 font-semibold text-ink" numberOfLines={1}>
          {waiver.title}
        </Text>
        <WaiverStatusLabel status={waiver.status} />
      </View>
      <Text className="mb-1 text-muted">
        {[waiver.teamName, forSomeoneElse ? waiver.memberName : undefined].filter(Boolean).join(' · ')}
      </Text>
      {waiver.dueDate !== undefined && waiver.status !== 'signed' ? (
        <Text className="mb-1 text-muted">{t('payments.dueOn', { date: waiver.dueDate })}</Text>
      ) : null}
      {waiver.signedAt !== undefined && waiver.status === 'signed' ? (
        <Text className="mb-1 text-muted">
          {t('waivers.signedOn', { date: new Date(waiver.signedAt).toLocaleDateString(i18n.language) })}
        </Text>
      ) : null}
      {waiver.status === 'outdated' ? <Text className="mb-1 text-ink">{t('waivers.changedSinceSigned')}</Text> : null}
      {onSign !== undefined && waiver.canSign ? <Button label={t('waivers.readAndSign')} onPress={onSign} /> : null}
      {onSign !== undefined && !waiver.canSign ? <Text className="mb-1 text-muted">{t('waivers.guardianSigns')}</Text> : null}
      {waiver.signedAt !== undefined ? (
        <Button label={t('waivers.viewSigned')} tone="secondary" onPress={onView} />
      ) : null}
    </View>
  );
};
