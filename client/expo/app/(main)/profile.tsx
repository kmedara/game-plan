/**
 * Profile photo, phone, positions, theme note, and sign-out.
 */

import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Platform, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UserProfile } from '@gameplan/types';
import { config } from '@/src/config';
import { useApp } from '@/src/state';
import { Button, ErrorText, Field } from '@/src/ui';

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { api, live, refreshTeams, teams } = useApp();
  const [profile, setProfile] = useState<UserProfile | undefined>(api.user);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [phone, setPhone] = useState(api.user?.phoneNumber ?? '');
  const [position, setPosition] = useState('');
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

  const savePhone = async (): Promise<void> => {
    const next = await api.updateProfile({
      phoneNumber: phone.trim().length === 0 ? null : phone.trim(),
    });
    setProfile(next);
  };

  const addPosition = async (teamId: string, current: readonly string[]): Promise<void> => {
    const value = position.trim();
    if (value.length === 0) return;
    try {
      await api.setPositions(teamId, [...current, value]);
      setPosition('');
      await refreshTeams();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    }
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
    <ScrollView className="flex-1 px-4 pt-4">
      <ErrorText message={error} />
      {photoUrl !== undefined ? <Image source={{ uri: photoUrl }} className="mb-3 h-24 w-24 rounded-full" /> : null}
      <Text className="mb-1 text-2xl font-bold">{profile?.displayName}</Text>
      <Text className="mb-4 text-slate-600">{profile?.email}</Text>
      <Button label={t('profile.addPhoto')} onPress={() => void upload()} />
      <Field label={t('profile.phoneNumber')} value={phone} onChangeText={setPhone} />
      <Button label={t('profile.savePhone')} onPress={() => void savePhone()} />
      <Text className="mb-2 mt-4 text-lg font-semibold">{t('profile.positions')}</Text>
      {teams.map((team) => (
        <View key={team.teamId} className="mb-3">
          <Text className="font-semibold">{team.name}</Text>
          <Text className="text-slate-600">{(team.positions ?? []).join(', ')}</Text>
          <Field label={t('profile.position')} value={position} onChangeText={setPosition} />
          <Button label={t('common.add')} onPress={() => void addPosition(team.teamId, team.positions ?? [])} />
        </View>
      ))}
      <Button label={t('profile.signOut')} onPress={() => void logout()} color="#b91c1c" />
    </ScrollView>
  );
}
