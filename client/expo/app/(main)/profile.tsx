/**
 * Profile photo, phone, positions, theme note, and sign-out.
 */

import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { positionsWithinLimit } from '@gameplan/rules';
import type { UserProfile } from '@gameplan/types';
import { config } from '@/src/config';
import { toE164Phone } from '@/src/phone';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field, ProfilePhoto, SubmitButton } from '@/src/ui';

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api, live, refreshTeams, teams, brand } = useApp();
  const [profile, setProfile] = useState<UserProfile | undefined>(api.user);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [phone, setPhone] = useState(api.user?.phoneNumber ?? '');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    void api.getMe().then(async (next) => {
      setProfile(next);
      setPhone(next.phoneNumber ?? '');
      if (next.photoKey !== undefined) {
        const download = await api.presignDownload(next.photoKey);
        setPhotoUrl(download.downloadUrl);
      }
    }).catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'));
    void refreshTeams();
  }, [api]);

  const upload = async (): Promise<void> => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (picked.canceled || picked.assets[0] === undefined) return;
    const asset = picked.assets[0];
    const contentType = asset.mimeType ?? 'image/jpeg';
    const blob = await (await fetch(asset.uri)).blob();
    if (blob.size > PHOTO_MAX_BYTES) {
      setError(t('chats.attachFailed'));
      return;
    }
    const presign = await api.presignUpload(contentType, blob.size);
    const uploadResponse = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: blob,
    });
    if (!uploadResponse.ok) {
      setError(t('chats.attachFailed'));
      return;
    }
    const next = await api.updateProfile({ photoKey: presign.objectKey });
    setProfile(next);
    const download = await api.presignDownload(presign.objectKey);
    setPhotoUrl(download.downloadUrl);
  };

  const savePhone = async (): Promise<boolean | void> => {
    const trimmed = phone.trim();
    if (trimmed.length === 0) {
      const next = await api.updateProfile({ phoneNumber: null });
      setProfile(next);
      setPhone('');
      return;
    }
    const e164 = toE164Phone(trimmed);
    if (e164 === undefined) throw new Error('bad_phone');
    const next = await api.updateProfile({ phoneNumber: e164 });
    setProfile(next);
    setPhone(e164);
  };

  const savePositions = async (teamId: string, next: readonly string[]): Promise<boolean> => {
    if (!positionsWithinLimit(next)) {
      setError('too_many_positions');
      return false;
    }
    try {
      setError(undefined);
      await api.setPositions(teamId, [...next]);
      await refreshTeams();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
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
          <View className="h-3.5 w-3.5 items-center justify-center">
            <View className="absolute h-0.5 w-3.5 rounded-full bg-white" />
            <View className="absolute h-3.5 w-0.5 rounded-full bg-white" />
          </View>
        </Pressable>
      </View>
      <Text className="mb-1 text-2xl font-bold text-ink">{profile?.displayName}</Text>
      <Text className="mb-4 text-muted">{profile?.email}</Text>
      <Field label={t('profile.phoneNumber')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <SubmitButton
        label={t('profile.savePhone')}
        onPress={savePhone}
        message={(err) =>
          err instanceof Error && err.message === 'bad_phone' ? t('errors.profile.badPhone') : t('errors.profile.savePhoneFailed')
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
                <View className="h-3 w-3 items-center justify-center">
                  <View className="absolute h-0.5 w-3 rounded-full bg-white" />
                  <View className="absolute h-3 w-0.5 rounded-full bg-white" />
                </View>
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
