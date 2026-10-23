/**
 * Apple and Google sign-in buttons for the providers this deployment has.
 *
 * Apple comes first: App Review asks that it be at least as prominent as any
 * other social sign-in.
 */

import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import type { SocialProvider } from '@gameplan/types';
import { AppleSignInButton } from './apple-sign-in-button';

/** Social sign-ins the login screen has buttons for, in display order. */
const SHOWN: readonly SocialProvider[] = ['apple', 'google'];

/** Google's four-color "G", as its sign-in branding requires. */
const GoogleMark = () => (
  <Svg width={18} height={18} viewBox="0 0 48 48">
    <Path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <Path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <Path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <Path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </Svg>
);

const GoogleSignInButton = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable
    accessibilityRole="button"
    className="h-12 w-full flex-row items-center justify-center rounded-lg border border-line bg-paper"
    onPress={onPress}
  >
    <GoogleMark />
    <Text className="ml-3 text-base font-semibold text-ink">{label}</Text>
  </Pressable>
);

/**
 * One button per configured social provider.
 *
 * @param providers - From `GET /identity/oauth/providers`.
 * @param onSignIn - Starts the sign-in for one provider.
 */
export const SocialSignIn = ({
  providers,
  onSignIn,
}: {
  providers: readonly SocialProvider[];
  onSignIn: (provider: SocialProvider) => void;
}) => {
  const { t } = useTranslation();
  const shown = SHOWN.filter((provider) => providers.includes(provider));
  if (shown.length === 0) return null;
  return (
    <View className="mb-4">
      {shown.map((provider) => (
        <View key={provider} className="mb-3">
          {provider === 'apple' ? (
            <AppleSignInButton label={t('auth.continueApple')} onPress={() => onSignIn('apple')} />
          ) : (
            <GoogleSignInButton label={t('auth.continueGoogle')} onPress={() => onSignIn('google')} />
          )}
        </View>
      ))}
      <Text className="text-center text-muted">{t('auth.or')}</Text>
    </View>
  );
};
