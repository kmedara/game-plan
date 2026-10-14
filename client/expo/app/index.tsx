/**
 * Sends the visitor to teams when a session restores, otherwise to login.
 */

import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useApp } from '@/src/state';

export default function Index() {
  const { api } = useApp();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void api.refreshSession().then((ok) => {
      setSignedIn(ok);
      setReady(true);
    });
  }, [api]);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (!signedIn) return <Redirect href="/login" />;
  if (api.user?.needsProfileCompletion) return <Redirect href="/complete-profile" />;
  return <Redirect href="/teams" />;
}
