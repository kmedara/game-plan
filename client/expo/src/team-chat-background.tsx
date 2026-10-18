/**
 * Wallpaper for the team's default chat. A dark overlay sits on top in the thread.
 */

import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamTheme } from '@gameplan/types';
import { useDownloadUrl } from './media';
import { AddMark, RemoveBadge, chatOverlayColor, useTeamImageSetting, type ChatBackgroundOverlay } from './team-media';
import { ErrorText } from './ui';

const overlayLabel = {
  dark: 'teamAdmin.overlayDark',
  light: 'teamAdmin.overlayLight',
  none: 'teamAdmin.overlayNone',
} as const;

export const TeamChatBackground = ({
  teamId,
  theme,
  onOverlayChange,
  onSaved,
}: {
  teamId: string;
  theme: TeamTheme | undefined;
  onOverlayChange: (overlay: ChatBackgroundOverlay) => void;
  onSaved: (theme: TeamTheme | undefined) => void;
}) => {
  const { t } = useTranslation();
  const uri = useDownloadUrl(theme?.chatBackgroundKey, { teamId });
  const { error, upload, clear } = useTeamImageSetting({
    teamId,
    themePatch: (chatBackgroundKey) =>
      chatBackgroundKey === undefined
        ? { chatBackgroundKey: null, chatBackgroundOverlay: null }
        : { chatBackgroundKey },
    onSaved,
  });

  const overlay = theme?.chatBackgroundOverlay ?? 'dark';
  const scrim = chatOverlayColor(overlay);

  return (
    <View className="mb-4 items-center">
      {theme?.chatBackgroundKey === undefined ? (
        <Text className="mb-2 self-stretch text-sm text-muted">{t('teamAdmin.chatBackgroundHint')}</Text>
      ) : null}
      <View className="w-full" style={{ position: 'relative' }}>
        <Pressable
          className="h-28 items-center justify-center overflow-hidden rounded-xl bg-inset"
          onPress={() => void upload()}
          accessibilityRole="button"
          accessibilityLabel={t(theme?.chatBackgroundKey === undefined ? 'teamAdmin.addBackground' : 'teamAdmin.changeBackground')}
        >
          {theme?.chatBackgroundKey !== undefined && uri !== undefined ? (
            <Image source={{ uri }} style={{ width: '100%', height: 112 }} contentFit="cover" />
          ) : null}
          {theme?.chatBackgroundKey !== undefined && scrim !== undefined ? (
            <View className="absolute bottom-0 left-0 right-0 top-0" style={{ backgroundColor: scrim }} />
          ) : null}
          {theme?.chatBackgroundKey === undefined ? <AddMark /> : null}
        </Pressable>
        {theme?.chatBackgroundKey !== undefined ? <RemoveBadge label={t('teamAdmin.removeBackground')} onPress={clear} /> : null}
      </View>
      <Text className="mt-1 text-sm text-ink">{t('teamAdmin.chatBackground')}</Text>
      {theme?.chatBackgroundKey !== undefined ? (
        <View className="mt-3 w-full flex-row gap-2">
          {(['dark', 'light', 'none'] as const).map((choice) => (
            <Pressable
              key={choice}
              className={`flex-1 items-center rounded-full border px-3 py-2 ${overlay === choice ? 'border-ink bg-inset' : 'border-line'}`}
              onPress={() => {
                if (choice === overlay) return;
                onOverlayChange(choice);
              }}
              accessibilityRole="button"
            >
              <Text className="text-sm text-ink">{t(overlayLabel[choice])}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ErrorText message={error} />
    </View>
  );
};
