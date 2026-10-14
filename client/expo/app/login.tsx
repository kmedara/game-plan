/**
 * Cognito Hosted UI on the web, and a one-time-code handoff on device.
 */

import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { config, NATIVE_AUTH_REDIRECT } from '@/src/config';
import { registerPush } from '@/src/push';
import { useApp } from '@/src/state';
import { Button, ErrorText } from '@/src/ui';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string }>();
  const { api, live } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(
    typeof params.error === 'string' ? params.error : undefined,
  );
  const [seedEmail, setSeedEmail] = useState('');

  useEffect(() => {
    if (!config.authDisabled) return;
    void api.refreshSession().then((ok) => {
      if (ok) setSeedEmail(api.user?.email ?? '');
    });
  }, [api]);

  const enter = (): void => {
    live.connect();
    void registerPush(api);
    router.replace(api.user?.needsProfileCompletion ? '/complete-profile' : '/teams');
  };

  const startHostedUi = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const returnTo = encodeURIComponent(`${window.location.origin}/teams`);
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
      if (reason !== null) {
        setError(reason);
        return;
      }
      if (code === null) throw new Error('missing_code');
      const session = await api.exchangeOAuth(code);
      live.connect();
      void registerPush(api);
      router.replace(session.next === 'complete-profile' ? '/complete-profile' : '/teams');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  };

  const continueLocal = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const ok = await api.refreshSession();
      if (!ok) throw new Error('seed_session_failed');
      setSeedEmail(api.user?.email ?? '');
      enter();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 justify-center px-6">
      <Text className="mb-2 text-3xl font-bold text-slate-900">{t('auth.signIn')}</Text>
      <Text className="mb-6 text-slate-600">{t('auth.tagline')}</Text>
      <ErrorText message={error} />
      {config.authDisabled ? (
        <>
          <Text className="mb-3 text-slate-700">
            {t('auth.localBypass', { email: seedEmail.length > 0 ? seedEmail : t('auth.seedUser') })}
          </Text>
          <Button label={t('auth.continue')} onPress={() => void continueLocal()} disabled={busy} />
        </>
      ) : (
        <>
          <Button label={t('auth.continueCognito')} onPress={() => void startHostedUi()} disabled={busy} />
          <Text className="text-slate-500">{t('auth.cognitoHint')}</Text>
        </>
      )}
    </View>
  );
}
