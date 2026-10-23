/**
 * Public privacy policy at `/privacy`. Open without signing in, so the stores,
 * App Review, and people deciding whether to join can read it.
 */

import { useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { config } from '@/src/config';
import { openLink } from '@/src/open-link';
import { POLICY_UPDATED, policyFor } from '@/src/privacy-policy';
import { colors } from '@/src/theme';

export default function PrivacyScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const policy = policyFor(i18n.language);
  const [before, after] = policy.contact.split('{{email}}');

  const leave = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }}
    >
      <View className="w-full max-w-2xl self-center px-5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('nav.back')}
          className="mb-4 h-10 w-10 items-center justify-center"
          onPress={leave}
        >
          <ChevronLeft size={24} color={colors.ink} />
        </Pressable>
        <Text accessibilityRole="header" className="mb-1 text-3xl font-bold text-ink">
          {policy.title}
        </Text>
        <Text className="mb-5 text-muted">
          {policy.updatedLabel}: {POLICY_UPDATED}
        </Text>
        <Text className="mb-6 text-base leading-6 text-ink">{policy.intro}</Text>
        {policy.sections.map((section) => (
          <View key={section.title} className="mb-6">
            <Text accessibilityRole="header" className="mb-2 text-xl font-semibold text-ink">
              {section.title}
            </Text>
            {section.body.map((paragraph) => (
              <Text key={paragraph} className="mb-2 text-base leading-6 text-ink">
                {paragraph}
              </Text>
            ))}
            {section.bullets?.map((bullet) => (
              <View key={bullet} className="mb-2 flex-row pl-1">
                <Text className="mr-2 text-base leading-6 text-ink">{'•'}</Text>
                <Text className="flex-1 text-base leading-6 text-ink">{bullet}</Text>
              </View>
            ))}
          </View>
        ))}
        {config.supportEmail.length > 0 ? (
          <Text className="text-base leading-6 text-ink">
            {before}
            <Text
              accessibilityRole="link"
              className="text-link underline"
              onPress={() => void openLink(`mailto:${config.supportEmail}`)}
            >
              {config.supportEmail}
            </Text>
            {after}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
