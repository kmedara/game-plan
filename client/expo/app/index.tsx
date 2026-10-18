/**
 * Sends the visitor to the schedule when a session restores, otherwise to login.
 *
 * A website visitor with no session hint goes straight to login without a refresh request.
 */

import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useApp } from '@/src/state';
import { colors } from '@/src/theme';

export default function Index() {
  const { api } = useApp();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void (async () => {
      const ok = (await api.mightHaveSession()) && (await api.ensureSession());
      setSignedIn(ok);
      setReady(true);
    })();
  }, [api]);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color={colors.field} />
      </View>
    );
  }

  if (!signedIn) return <Redirect href="/login" />;
  if (api.user?.needsProfileCompletion) return <Redirect href="/complete-profile" />;
  return <Redirect href="/schedule" />;
}
