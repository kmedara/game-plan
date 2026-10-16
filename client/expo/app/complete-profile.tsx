/**
 * Birthday and display name after the first social sign-in.
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BirthdayField } from '@/src/birthday-field';
import { useApp } from '@/src/state';
import { Field, SubmitButton } from '@/src/ui';

/** Cognito social sign-in stores the user id as the username. That is not a name. */
const isIdShapedName = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());

const prefilledName = (value: string | undefined): string => {
  if (value === undefined || value.trim().length === 0 || isIdShapedName(value)) return '';
  return value;
};

export default function CompleteProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api } = useApp();
  const [displayName, setDisplayName] = useState(prefilledName(api.user?.displayName));
  const [birthday, setBirthday] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.refreshSession().then((ok) => {
      const name = prefilledName(api.user?.displayName);
      if (ok && name.length > 0) setDisplayName(name);
    });
  }, [api]);

  const submit = async (): Promise<boolean | void> => {
    if (displayName.trim().length === 0 || birthday.trim().length === 0) return false;
    setBusy(true);
    try {
      if (!api.isAuthenticated()) {
        const restored = await api.refreshSession();
        if (!restored) throw new Error('unauthorized');
      }
      await api.completeProfile({ birthday: birthday.trim(), displayName: displayName.trim() });
      router.replace('/teams');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 justify-center bg-canvas px-6">
      <View className="rounded-2xl border border-line bg-paper px-5 py-6 shadow-md">
        <Text className="mb-1 text-sm font-semibold uppercase tracking-widest text-field">GamePlan</Text>
        <Text className="mb-2 text-2xl font-bold text-ink">{t('completeProfile.title')}</Text>
        <Text className="mb-4 text-muted">{t('completeProfile.hint')}</Text>
        <Field label={t('completeProfile.displayName')} value={displayName} onChangeText={setDisplayName} />
        <BirthdayField label={t('completeProfile.birthday')} value={birthday} onChange={setBirthday} />
        <SubmitButton label={t('common.save')} onPress={submit} disabled={busy} />
      </View>
    </View>
  );
}
