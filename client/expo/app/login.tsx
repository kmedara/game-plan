/**
 * Cognito Hosted UI on the web, and a one-time-code handoff on device.
 */

import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { config, NATIVE_AUTH_REDIRECT } from '@/src/config';
import { useApp } from '@/src/state';
import { ErrorText, SubmitButton } from '@/src/ui';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string }>();
  const { api, live } = useApp();
  const [error] = useState<string | undefined>(
    typeof params.error === 'string' ? params.error : undefined,
  );
  const [seedEmail, setSeedEmail] = useState('');

  useEffect(() => {
    if (!config.authDisabled) return;
    void api.ensureSession().then((ok) => {
      if (ok) setSeedEmail(api.user?.email ?? '');
    });
  }, [api]);

  const enter = (): void => {
    live.connect();
    router.replace(api.user?.needsProfileCompletion ? '/complete-profile' : '/schedule');
  };

  const startHostedUi = async (): Promise<void> => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const returnTo = encodeURIComponent(`${window.location.origin}/schedule`);
      window.location.href = `${config.apiBaseUrl}/identity/oauth/login?returnTo=${returnTo}`;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(
      `${config.apiBaseUrl}/identity/oauth/login?delivery=native`,
      NATIVE_AUTH_REDIRECT,
    );
    if (result.type !== 'success') return;
    const url = new URL(result.url);
    const code = url.searchParams.get('code');
    const reason = url.searchParams.get('error');
    if (reason !== null) throw new Error(reason);
    if (code === null) throw new Error('missing_code');
    const session = await api.exchangeOAuth(code);
    live.connect();
    router.replace(session.next === 'complete-profile' ? '/complete-profile' : '/schedule');
  };

  const continueLocal = async (): Promise<void> => {
    const ok = await api.ensureSession();
    if (!ok) throw new Error('seed_session_failed');
    setSeedEmail(api.user?.email ?? '');
    enter();
  };

  return (
    <View className="flex-1 justify-center bg-canvas px-6">
      <View className="rounded-2xl border border-line bg-paper px-5 py-6 shadow-md">
        <Text className="mb-1 text-sm font-semibold uppercase tracking-widest text-field">GamePlan</Text>
        <Text className="mb-2 text-3xl font-bold text-ink">{t('auth.signIn')}</Text>
        <Text className="mb-6 text-muted">{t('auth.tagline')}</Text>
        <ErrorText message={error} />
        {config.authDisabled ? (
          <>
            <Text className="mb-3 text-ink">
              {t('auth.localBypass', { email: seedEmail.length > 0 ? seedEmail : t('auth.seedUser') })}
            </Text>
            <SubmitButton label={t('auth.continue')} onPress={continueLocal} />
          </>
        ) : (
          <>
            <SubmitButton label={t('auth.continueCognito')} onPress={startHostedUi} loadedText="" />
            <Text className="text-muted">{t('auth.cognitoHint')}</Text>
          </>
        )}
      </View>
    </View>
  );
}
