/**
 * Root stack: public auth screens and the signed-in shell.
 */

import '../global.css';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { bindQueryManagers, createQueryClient, persistOptions } from '@/src/query-client';
import { AppStateProvider } from '@/src/state';
import { colors } from '@/src/theme';
import '@/src/i18n';

bindQueryManagers();

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}
        onSuccess={() => void queryClient.resumePausedMutations()}
      >
        <AppStateProvider>
          <StatusBar style="dark" />
          <View className="flex-1 bg-canvas">
            <Suspense fallback={<View className="flex-1 bg-canvas" />}>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="login" />
                <Stack.Screen name="complete-profile" />
                <Stack.Screen name="(main)" />
              </Stack>
            </Suspense>
          </View>
        </AppStateProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
