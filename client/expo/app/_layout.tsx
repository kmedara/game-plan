/**
 * Root stack: public auth screens and the signed-in shell.
 */

import '../global.css';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiClient } from '@/src/api';
import { bindQueryManagers, createQueryClient, openPersistedCache, persistOptions } from '@/src/query-client';
import { AppStateProvider } from '@/src/state';
import { colors } from '@/src/theme';
import '@/src/i18n';

bindQueryManagers();

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const [api] = useState(() => new ApiClient());
  const [buster, setBuster] = useState<string | undefined>();

  useEffect(() => {
    void (async () => {
      const ok = (await api.mightHaveSession()) && (await api.ensureSession());
      setBuster(await openPersistedCache(ok ? api.user?.userId : undefined));
    })();
  }, [api]);

  if (buster === undefined) {
    return (
      <SafeAreaProvider>
        <View className="flex-1 bg-canvas" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ ...persistOptions, buster }}
        onSuccess={() => void queryClient.resumePausedMutations()}
      >
        <AppStateProvider api={api}>
          <StatusBar style="dark" />
          <View className="flex-1 bg-canvas">
            <Suspense fallback={<View className="flex-1 bg-canvas" />}>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="login" />
                <Stack.Screen name="complete-profile" />
                <Stack.Screen name="privacy" />
                <Stack.Screen name="(main)" />
              </Stack>
            </Suspense>
          </View>
        </AppStateProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
