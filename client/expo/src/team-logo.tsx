/**
 * Team logo picker. Uploads through the media presign API and saves the key on the team theme.
 */

import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamTheme } from '@gameplan/types';
import { useDownloadUrl } from './media';
import { AddMark, TrashIcon, useTeamImageSetting } from './team-media';
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
  const uri = useDownloadUrl(theme?.logoKey, { teamId });
  const { error, upload, clear } = useTeamImageSetting({
    teamId,
    themePatch: (logoKey) => ({ logoKey: logoKey ?? null }),
    onSaved,
  });

  return (
    <View className="mb-6 shrink-0 items-center">
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
