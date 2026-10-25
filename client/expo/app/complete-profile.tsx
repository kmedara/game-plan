/**
 * Birthday and first and last name after the first social sign-in, or names
 * alone for an older account that has a birthday but no names yet.
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UserProfile } from '@gameplan/types';
import { BirthdayField } from '@/src/birthday-field';
import { useApp } from '@/src/state';
import { Field, SubmitButton } from '@/src/ui';

/** Cognito social sign-in stores the user id as the username. That is not a name. */
const isIdShapedName = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());

/**
 * Names to start the form with: the stored ones, else a sign-in name of two or
 * more words split at the first space. One word is often an email prefix, so
 * it is not offered.
 */
const prefilledNames = (user: UserProfile | undefined): { firstName: string; lastName: string } => {
  if (user?.firstName !== undefined || user?.lastName !== undefined) {
    return { firstName: user.firstName ?? '', lastName: user.lastName ?? '' };
  }
  const displayName = user?.displayName?.trim() ?? '';
  if (displayName.length === 0 || isIdShapedName(displayName)) return { firstName: '', lastName: '' };
  const [first = '', ...rest] = displayName.split(/\s+/);
  if (rest.length === 0) return { firstName: '', lastName: '' };
  return { firstName: first, lastName: rest.join(' ') };
};

export default function CompleteProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api } = useApp();
  const [firstName, setFirstName] = useState(prefilledNames(api.user).firstName);
  const [lastName, setLastName] = useState(prefilledNames(api.user).lastName);
  const [hasBirthday, setHasBirthday] = useState(api.user?.birthday !== undefined);
  const [birthday, setBirthday] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.ensureSession().then((ok) => {
      if (!ok) return;
      const names = prefilledNames(api.user);
      setFirstName((current) => (current.length > 0 ? current : names.firstName));
      setLastName((current) => (current.length > 0 ? current : names.lastName));
      setHasBirthday(api.user?.birthday !== undefined);
    });
  }, [api]);

  const submit = async (): Promise<boolean | void> => {
    if (firstName.trim().length === 0 || lastName.trim().length === 0) return false;
    if (!hasBirthday && birthday.trim().length === 0) return false;
    setBusy(true);
    try {
      if (!api.isAuthenticated()) {
        const restored = await api.ensureSession();
        if (!restored) throw new Error('unauthorized');
      }
      await api.completeProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(hasBirthday ? {} : { birthday: birthday.trim() }),
      });
      router.replace('/schedule');
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
        <Field
          label={t('completeProfile.firstName')}
          placeholder={t('completeProfile.firstName')}
          hideLabel
          value={firstName}
          onChangeText={setFirstName}
        />
        <Field
          label={t('completeProfile.lastName')}
          placeholder={t('completeProfile.lastName')}
          hideLabel
          value={lastName}
          onChangeText={setLastName}
        />
        {hasBirthday ? null : (
          <BirthdayField label={t('completeProfile.birthday')} value={birthday} onChange={setBirthday} />
        )}
        <SubmitButton label={t('common.save')} onPress={submit} disabled={busy} />
      </View>
    </View>
  );
}
