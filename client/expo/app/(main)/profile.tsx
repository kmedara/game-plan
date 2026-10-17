/**
 * Profile photo, phone, positions, theme note, and sign-out.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import Plus from 'lucide-react-native/icons/plus';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { positionsWithinLimit } from '@gameplan/rules';
import { config } from '@/src/config';
import { errorMessageKey } from '@/src/errors';
import { pickAndUploadImage, useDownloadUrl } from '@/src/media';
import { meQuery, updateProfileMutation } from '@/src/queries/profile';
import { setPositionsMutation } from '@/src/queries/teams';
import { clearPersistedCache } from '@/src/query-client';
import { toE164Phone } from '@/src/phone';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field, ProfilePhoto, SubmitButton } from '@/src/ui';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api, live, teams, brand } = useApp();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery(api));
  const saveProfile = useMutation(updateProfileMutation(api, queryClient));
  const savePositionsMutation = useMutation(setPositionsMutation(api, queryClient));
  const profile = me.data ?? api.user;
  const photoUrl = useDownloadUrl(profile?.photoKey);
  const [phone, setPhone] = useState(api.user?.phoneNumber ?? '');
  const [phoneReady, setPhoneReady] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (phoneReady || me.data === undefined) return;
    setPhone(me.data.phoneNumber ?? '');
    setPhoneReady(true);
  }, [me.data, phoneReady]);

  useEffect(() => {
    if (me.error !== undefined) setError(t(errorMessageKey(me.error, 'errors.profile.loadFailed')));
  }, [me.error, t]);

  const upload = async (): Promise<void> => {
    const result = await pickAndUploadImage(api, { quality: 0.8 });
    if (result === undefined) return;
    if ('error' in result) {
      setError(t('chats.attachFailed'));
      return;
    }
    try {
      await saveProfile.mutateAsync({ photoKey: result.key });
    } catch {
      setError(t('chats.attachFailed'));
    }
  };

  const savePhone = async (): Promise<boolean | void> => {
    const trimmed = phone.trim();
    if (trimmed.length === 0) {
      await saveProfile.mutateAsync({ phoneNumber: null });
      setPhone('');
      return;
    }
    const e164 = toE164Phone(trimmed);
    if (e164 === undefined) throw new Error('bad_phone');
    await saveProfile.mutateAsync({ phoneNumber: e164 });
    setPhone(e164);
  };

  const savePositions = async (teamId: string, next: readonly string[]): Promise<boolean> => {
    if (!positionsWithinLimit(next)) {
      setError(t('errors.position.tooMany'));
      return false;
    }
    try {
      setError(undefined);
      await savePositionsMutation.mutateAsync({ teamId, positions: [...next] });
      return true;
    } catch (err) {
      setError(
        t(
          errorMessageKey(err, 'errors.position.saveFailed', {
            too_many_positions: 'errors.position.tooMany',
            invalid_body: 'errors.position.invalid',
          }),
        ),
      );
      return false;
    }
  };

  const addPosition = async (teamId: string, current: readonly string[]): Promise<void> => {
    const value = (drafts[teamId] ?? '').trim();
    if (value.length === 0) return;
    const saved = await savePositions(teamId, [...current, value]);
    if (saved) setDrafts((existing) => ({ ...existing, [teamId]: '' }));
  };

  const logout = async (): Promise<void> => {
    live.disconnect();
    await clearPersistedCache(queryClient);
    if (!config.authDisabled && Platform.OS !== 'web') {
      await api.logout();
      await WebBrowser.openBrowserAsync(`${config.apiBaseUrl}/identity/oauth/logout`);
      router.replace('/login');
      return;
    }
    await api.logout();
    if (Platform.OS !== 'web') router.replace('/login');
  };

  return (
    <View className="flex-1">
    <ScrollView className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      <View className="mb-3 h-24 w-24">
        <ProfilePhoto name={profile?.displayName} uri={photoUrl} />
        <Pressable
          accessibilityLabel={t('profile.addPhoto')}
          className="absolute -right-1 -top-1 h-7 w-7 items-center justify-center rounded-full border-2 border-paper"
          style={{ backgroundColor: brand.primary }}
          onPress={() => void upload()}
        >
          <Plus size={14} color={brand.onPrimary} strokeWidth={3} />
        </Pressable>
      </View>
      <Text className="mb-1 text-2xl font-bold text-ink">{profile?.displayName}</Text>
      <Text className="mb-4 text-muted">{profile?.email}</Text>
      <Field label={t('profile.phoneNumber')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <SubmitButton
        label={t('profile.savePhone')}
        onPress={savePhone}
        message={(err) =>
          t(errorMessageKey(err, 'errors.profile.savePhoneFailed', { bad_phone: 'errors.profile.badPhone' }))
        }
      />
      <Text className="mb-2 mt-4 text-lg font-semibold text-ink">{t('profile.positions')}</Text>
      {teams.map((team) => {
        const positions = team.positions ?? [];
        return (
          <View key={team.teamId} className="mb-3">
            <Text className="mb-1 font-semibold text-ink">{team.name}</Text>
            <View className="flex-row flex-wrap items-center">
              {positions.map((name) => (
                <View key={name} className="mb-2 mr-2 flex-row items-center rounded-full border border-line bg-paper px-2 py-1">
                  <Text className="text-sm text-ink">{name}</Text>
                  <Pressable
                    accessibilityLabel={t('profile.removePosition', { position: name })}
                    className="ml-1 h-5 w-5 items-center justify-center"
                    onPress={() => void savePositions(team.teamId, positions.filter((item) => item !== name))}
                  >
                    <Text className="text-sm leading-4 text-muted">×</Text>
                  </Pressable>
                </View>
              ))}
              <TextInput
                className="mb-2 mr-2 w-28 rounded-full border border-line bg-inset px-2 py-1 text-sm leading-5 text-ink"
                value={drafts[team.teamId] ?? ''}
                onChangeText={(value) => setDrafts((existing) => ({ ...existing, [team.teamId]: value }))}
                placeholder={t('profile.position')}
                onSubmitEditing={() => void addPosition(team.teamId, positions)}
              />
              <Pressable
                accessibilityLabel={t('common.add')}
                className="mb-2 h-7 w-7 items-center justify-center rounded-full"
                style={{ backgroundColor: brand.primary }}
                onPress={() => void addPosition(team.teamId, positions)}
              >
                <Plus size={12} color={brand.onPrimary} strokeWidth={3} />
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
    <View className="px-4 pb-2">
      <Button label={t('profile.signOut')} onPress={() => void logout()} tone="danger" />
    </View>
    </View>
  );
}
