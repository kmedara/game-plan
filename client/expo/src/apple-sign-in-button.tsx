/**
 * "Continue with Apple" on Android and the website, where Apple's native button does not exist.
 */

import { Pressable, Text } from 'react-native';

export const AppleSignInButton = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable
    accessibilityRole="button"
    className="h-12 w-full items-center justify-center rounded-lg bg-black"
    onPress={onPress}
  >
    <Text className="text-base font-semibold text-white">{label}</Text>
  </Pressable>
);
