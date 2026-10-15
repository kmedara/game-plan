/**
 * Birthday and display name after the first social sign-in.
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field } from '@/src/ui';

export default function CompleteProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api } = useApp();
  const [displayName, setDisplayName] = useState(api.user?.displayName ?? '');
  const [birthday, setBirthday] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void api.refreshSession().then((ok) => {
      const name = api.user?.displayName;
      if (ok && name !== undefined && name.length > 0) setDisplayName(name);
    });
  }, [api]);

  const submit = async (): Promise<void> => {
    if (displayName.trim().length === 0 || birthday.trim().length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!api.isAuthenticated()) {
        const restored = await api.refreshSession();
        if (!restored) {
          setError('unauthorized');
          return;
        }
      }
      await api.completeProfile({ birthday: birthday.trim(), displayName: displayName.trim() });
      router.replace('/teams');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 justify-center px-6">
      <Text className="mb-2 text-2xl font-bold">{t('completeProfile.title')}</Text>
      <Text className="mb-4 text-slate-600">{t('completeProfile.hint')}</Text>
      <ErrorText message={error} />
      <Field label={t('completeProfile.displayName')} value={displayName} onChangeText={setDisplayName} />
      <Field label={t('completeProfile.birthday')} value={birthday} onChangeText={setBirthday} placeholder="YYYY-MM-DD" />
      <Button label={t('common.save')} onPress={() => void submit()} disabled={busy} />
    </View>
  );
}
