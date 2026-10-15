/**
 * Root stack: public auth screens and the signed-in shell.
 */

import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppStateProvider } from '@/src/state';
import { colors } from '@/src/theme';
import '@/src/i18n';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <StatusBar style="dark" />
        <View className="flex-1 bg-canvas">
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="complete-profile" />
            <Stack.Screen name="(main)" />
          </Stack>
        </View>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
