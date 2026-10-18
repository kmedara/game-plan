/**
 * Asks whether a recurring edit or delete applies to one date or the series.
 */

import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { errorMessageKey } from '@/src/errors';
import { Button, ErrorText } from '@/src/ui';

export const ScopeChoice = ({
  visible,
  title,
  onClose,
  onChoose,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onChoose: (scope: 'one' | 'all') => Promise<void>;
}) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | undefined>();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 px-6">
        <View className="w-full rounded-2xl bg-raised p-4">
          <Text className="mb-4 text-base text-ink">{title}</Text>
          <ErrorText message={error} />
          <Button
            label={t('schedule.thisOccurrence')}
            onPress={() => {
              void onChoose('one').catch((err: unknown) => {
                setError(t(errorMessageKey(err, 'errors.common.saveFailed')));
              });
            }}
          />
          <Button
            label={t('schedule.allOccurrences')}
            tone="secondary"
            onPress={() => {
              void onChoose('all').catch((err: unknown) => {
                setError(t(errorMessageKey(err, 'errors.common.saveFailed')));
              });
            }}
          />
          <Button label={t('common.cancel')} tone="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
};
