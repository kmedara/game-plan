/**
 * Cognito Hosted UI on the web, and a one-time-code handoff on device.
 *
 * Apple and Google buttons skip the Hosted UI page and go straight to that
 * provider; the email button opens the Hosted UI.
 */

import * as WebBrowser from 'expo-web-browser';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SocialProvider } from '@gameplan/types';
import { config, NATIVE_AUTH_REDIRECT } from '@/src/config';
import { errorMessageKey } from '@/src/errors';
import { SocialSignIn } from '@/src/social-sign-in';
import { useApp } from '@/src/state';
import { ErrorText, SubmitButton } from '@/src/ui';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ error?: string }>();
  const { api, live } = useApp();
  const [error, setError] = useState<string | undefined>(
    typeof params.error === 'string' ? params.error : undefined,
  );
  const [seedEmail, setSeedEmail] = useState('');
  const [providers, setProviders] = useState<SocialProvider[]>([]);

  useEffect(() => {
    if (config.authDisabled) return;
    let cancelled = false;
    void api.oauthProviders().then((list) => {
      if (!cancelled) setProviders(list);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

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

  const startHostedUi = async (provider?: SocialProvider): Promise<void> => {
    const providerQuery = provider === undefined ? '' : `&provider=${provider}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const returnTo = encodeURIComponent(`${window.location.origin}/schedule`);
      window.location.href = `${config.apiBaseUrl}/identity/oauth/login?returnTo=${returnTo}${providerQuery}`;
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(
      `${config.apiBaseUrl}/identity/oauth/login?delivery=native${providerQuery}`,
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

  const startSocial = (provider: SocialProvider): void => {
    setError(undefined);
    startHostedUi(provider).catch((err: unknown) => {
      setError(t(errorMessageKey(err, 'errors.common.requestFailed')));
    });
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
            <SocialSignIn providers={providers} onSignIn={startSocial} />
            <SubmitButton
              label={t(providers.length > 0 ? 'auth.continueEmail' : 'auth.continueCognito')}
              onPress={() => startHostedUi()}
              loadedText=""
              tone={providers.length > 0 ? 'secondary' : undefined}
            />
            <Text className="text-muted">{t(providers.length > 0 ? 'auth.emailHint' : 'auth.cognitoHint')}</Text>
          </>
        )}
      </View>
      <Link href="/privacy" className="mt-4 self-center text-muted underline">
        {t('auth.privacy')}
      </Link>
    </View>
  );
}
