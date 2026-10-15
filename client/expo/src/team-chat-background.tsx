/**
 * Wallpaper for the team's default chat. A dark overlay sits on top in the thread.
 */

import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamTheme } from '@gameplan/types';
import { useApp } from './state';
import { ErrorText } from './ui';

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const TeamChatBackground = ({
  teamId,
  theme,
  onSaved,
}: {
  teamId: string;
  theme: TeamTheme | undefined;
  onSaved: (theme: TeamTheme | undefined) => void;
}) => {
  const { t } = useTranslation();
  const { api, refreshTeams } = useApp();
  const [uri, setUri] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const key = theme?.chatBackgroundKey;
    if (key === undefined) {
      setUri(undefined);
      return;
    }
    let cancelled = false;
    void api.presignDownload(key, { teamId }).then((download) => {
      if (!cancelled) setUri(download.downloadUrl);
    }).catch(() => {
      if (!cancelled) setUri(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [api, teamId, theme?.chatBackgroundKey]);

  const saveTheme = async (chatBackgroundKey: string | undefined): Promise<void> => {
    const next = {
      ...(theme?.primary !== undefined ? { primary: theme.primary } : {}),
      ...(theme?.secondary !== undefined ? { secondary: theme.secondary } : {}),
      ...(theme?.accent !== undefined ? { accent: theme.accent } : {}),
      ...(theme?.logoKey !== undefined ? { logoKey: theme.logoKey } : {}),
      ...(chatBackgroundKey !== undefined ? { chatBackgroundKey } : {}),
    };
    const saved = await api.updateTeam(teamId, {
      theme: Object.keys(next).length > 0 ? next : null,
    });
    onSaved(saved.theme);
    await refreshTeams();
  };

  const upload = async (): Promise<void> => {
    setError(undefined);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    if (picked.canceled || picked.assets[0] === undefined) return;
    const asset = picked.assets[0];
    const contentType = asset.mimeType ?? 'image/jpeg';
    if (!IMAGE_TYPES.has(contentType)) {
      setError(t('errors.teamAdmin.badLogoType'));
      return;
    }
    const blob = await (await fetch(asset.uri)).blob();
    if (blob.size > MAX_BYTES) {
      setError(t('errors.teamAdmin.logoTooLarge'));
      return;
    }
    try {
      const presign = await api.presignUpload(contentType, blob.size);
      const uploadResponse = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body: blob,
      });
      if (!uploadResponse.ok) {
        setError(t('errors.teamAdmin.logoUploadFailed'));
        return;
      }
      await saveTheme(presign.objectKey);
    } catch {
      setError(t('errors.teamAdmin.logoUploadFailed'));
    }
  };

  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm text-muted">{t('teamAdmin.chatBackground')}</Text>
      <Text className="mb-2 text-sm text-muted">{t('teamAdmin.chatBackgroundHint')}</Text>
      {uri !== undefined ? (
        <View className="mb-2 h-28 overflow-hidden rounded-xl">
          <Image source={{ uri }} style={{ width: '100%', height: 112 }} resizeMode="cover" />
          <View className="absolute bottom-0 left-0 right-0 top-0" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} />
        </View>
      ) : null}
      <Pressable onPress={() => void upload()} accessibilityRole="button">
        <Text className="font-semibold text-ink">
          {theme?.chatBackgroundKey === undefined ? t('teamAdmin.addBackground') : t('teamAdmin.changeBackground')}
        </Text>
      </Pressable>
      {theme?.chatBackgroundKey !== undefined ? (
        <Pressable
          className="mt-1"
          onPress={() => void saveTheme(undefined).catch(() => setError(t('errors.teamAdmin.logoUploadFailed')))}
          accessibilityRole="button"
        >
          <Text className="text-muted">{t('teamAdmin.removeBackground')}</Text>
        </Pressable>
      ) : null}
      <ErrorText message={error} />
    </View>
  );
};
