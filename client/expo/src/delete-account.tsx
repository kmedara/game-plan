/**
 * Account deletion on the profile screen: what goes, a second tap to confirm,
 * and what has to be handed over first when the server refuses.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AccountDeletionBlocked } from './api';
import { errorMessageKey } from './errors';
import { useApp } from './state';
import { Button, SubmitButton } from './ui';

export const DeleteAccountSection = ({ onDeleted }: { onDeleted: () => Promise<void> }) => {
  const { t } = useTranslation();
  const { api } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState<AccountDeletionBlocked | undefined>();

  if (!confirming) {
    return (
      <View className="mb-6 mt-6">
        <Button label={t('account.delete')} tone="secondary" onPress={() => setConfirming(true)} />
      </View>
    );
  }

  const remove = async (): Promise<boolean> => {
    setBlocked(undefined);
    try {
      await api.deleteAccount();
    } catch (err) {
      if (err instanceof AccountDeletionBlocked) {
        setBlocked(err);
        return false;
      }
      throw err;
    }
    await onDeleted();
    return true;
  };

  return (
    <View className="mb-6 mt-6 rounded-xl border border-line bg-paper p-4">
      <Text className="mb-2 text-lg font-semibold text-ink">{t('account.deleteTitle')}</Text>
      <Text className="mb-2 text-ink">{t('account.deleteRemoves')}</Text>
      <Text className="mb-4 text-muted">{t('account.deleteKeeps')}</Text>
      {blocked !== undefined ? (
        <View className="mb-4">
          <Text className="mb-1 font-semibold text-danger">{t('account.blocked')}</Text>
          {blocked.ownedOrgs.map((name) => (
            <Text key={`org-${name}`} className="text-ink">
              {t('account.blockedOrg', { name })}
            </Text>
          ))}
          {blocked.soleAdminTeams.map((name) => (
            <Text key={`team-${name}`} className="text-ink">
              {t('account.blockedTeam', { name })}
            </Text>
          ))}
        </View>
      ) : null}
      <SubmitButton
        label={t('account.deleteConfirm')}
        tone="danger"
        loadedText=""
        onPress={remove}
        message={(err) => t(errorMessageKey(err, 'errors.account.deleteFailed'))}
      />
      <View className="mt-2">
        <Button
          label={t('common.cancel')}
          tone="secondary"
          onPress={() => {
            setConfirming(false);
            setBlocked(undefined);
          }}
        />
      </View>
    </View>
  );
};
