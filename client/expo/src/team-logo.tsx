/**
 * Team logo picker. Uploads through the media presign API and saves the key on the team theme.
 */

import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamTheme } from '@gameplan/types';
import { useApp } from './state';
import { ErrorText, ProfilePhoto } from './ui';

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const TeamLogo = ({
  teamId,
  name,
  theme,
  onSaved,
}: {
  teamId: string;
  name: string;
  theme: TeamTheme | undefined;
  onSaved: (theme: TeamTheme | undefined) => void;
}) => {
  const { t } = useTranslation();
  const { api, refreshTeams } = useApp();
  const [uri, setUri] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const key = theme?.logoKey;
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
  }, [api, teamId, theme?.logoKey]);

  const saveTheme = async (logoKey: string | undefined): Promise<void> => {
    const next = {
      ...(theme?.primary !== undefined ? { primary: theme.primary } : {}),
      ...(theme?.secondary !== undefined ? { secondary: theme.secondary } : {}),
      ...(theme?.accent !== undefined ? { accent: theme.accent } : {}),
      ...(logoKey !== undefined ? { logoKey } : {}),
      ...(theme?.chatBackgroundKey !== undefined ? { chatBackgroundKey: theme.chatBackgroundKey } : {}),
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
    if (!LOGO_TYPES.has(contentType)) {
      setError(t('errors.teamAdmin.badLogoType'));
      return;
    }
    const blob = await (await fetch(asset.uri)).blob();
    if (blob.size > LOGO_MAX_BYTES) {
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
    <View className="mb-4 items-center">
      <Text className="mb-2 text-sm text-muted">{t('teamAdmin.teamLogo')}</Text>
      <ProfilePhoto name={name} uri={uri} size={72} resizeMode="contain" />
      <Pressable className="mt-2" onPress={() => void upload()} accessibilityRole="button">
        <Text className="font-semibold text-ink">{theme?.logoKey === undefined ? t('teamAdmin.addLogo') : t('teamAdmin.changeLogo')}</Text>
      </Pressable>
      {theme?.logoKey !== undefined ? (
        <Pressable className="mt-1" onPress={() => void saveTheme(undefined).catch(() => setError(t('errors.teamAdmin.logoUploadFailed')))} accessibilityRole="button">
          <Text className="text-muted">{t('teamAdmin.removeLogo')}</Text>
        </Pressable>
      ) : null}
      <ErrorText message={error} />
    </View>
  );
};
