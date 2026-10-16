/**
 * Team logo picker. Uploads through the media presign API and saves the key on the team theme.
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamTheme } from '@gameplan/types';
import { useApp } from './state';
import { AddMark, TrashIcon, teamImageErrorKey, uploadTeamImage, useTeamImageUrl } from './team-media';
import { ErrorText, ProfilePhoto } from './ui';

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
  const { api, patchTeam } = useApp();
  const uri = useTeamImageUrl(teamId, theme?.logoKey);
  const [error, setError] = useState<string | undefined>();

  const saveTheme = async (logoKey: string | undefined): Promise<void> => {
    const saved = await api.updateTeam(teamId, {
      theme: { logoKey: logoKey ?? null },
    });
    patchTeam(saved);
    onSaved(saved.theme);
  };

  const upload = async (): Promise<void> => {
    setError(undefined);
    const result = await uploadTeamImage(api);
    if (result === undefined) return;
    if ('error' in result) {
      setError(t(teamImageErrorKey(result.error)));
      return;
    }
    try {
      await saveTheme(result.key);
    } catch {
      setError(t('errors.teamAdmin.logoUploadFailed'));
    }
  };

  const clear = (): void => {
    void saveTheme(undefined).catch(() => setError(t('errors.teamAdmin.logoUploadFailed')));
  };

  return (
    <View className="mb-3 shrink-0 items-center">
      <Pressable onPress={() => void upload()} accessibilityRole="button" accessibilityLabel={t('teamAdmin.changeLogo')}>
        {theme?.logoKey !== undefined ? (
          <ProfilePhoto name={name} uri={uri} size={36} resizeMode="contain" />
        ) : (
          <AddMark />
        )}
      </Pressable>
      <Text className="mt-1 text-sm text-ink">{t('teamAdmin.teamLogo')}</Text>
      {theme?.logoKey !== undefined ? (
        <Pressable className="mt-1" onPress={clear} accessibilityRole="button" accessibilityLabel={t('teamAdmin.removeLogo')}>
          <TrashIcon />
        </Pressable>
      ) : null}
      <ErrorText message={error} />
    </View>
  );
};
