/**
 * Root stack: public auth screens and the signed-in shell.
 */

import '../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppStateProvider } from '@/src/state';
import '@/src/i18n';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="complete-profile" />
          <Stack.Screen name="(main)" />
        </Stack>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
