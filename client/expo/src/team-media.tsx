/**
 * Shared team image settings and the trash control used under editable team settings.
 */

import Plus from 'lucide-react-native/icons/plus';
import Trash from 'lucide-react-native/icons/trash';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TeamTheme, UpdateTeamBody } from '@gameplan/types';
import { pickAndUploadImage, type ImageUploadFailure } from './media';
import { useApp } from './state';
import { colors, fieldWash, muteColor } from './theme';

export type ChatBackgroundOverlay = 'dark' | 'light' | 'none';

/** Scrim drawn over a chat wallpaper. Missing means the dark scrim. */
export const chatOverlayColor = (overlay: ChatBackgroundOverlay | undefined): string | undefined => {
  if (overlay === 'none') return undefined;
  if (overlay === 'light') return 'rgba(255,255,255,0.55)';
  return 'rgba(0,0,0,0.45)';
};

/** Translation key for a failed team image upload. */
export const teamImageErrorKey = (error: ImageUploadFailure): string => {
  if (error === 'bad_type') return 'errors.teamAdmin.badLogoType';
  if (error === 'too_large') return 'errors.teamAdmin.logoTooLarge';
  return 'errors.teamAdmin.logoUploadFailed';
};

/** Outline trash can. Defaults to a muted danger. Pass a color for a tinted can. */
export const TrashIcon = ({ color = fieldWash(colors.danger, .5) }: { color?: string }) => (
  <Trash size={16} color={color} strokeWidth={2} />
);

/** Plus shown inside an empty logo or background frame. */
export const AddMark = () => (
  <View className="h-9 w-9 items-center justify-center rounded-full border border-line">
    <Plus size={16} color={colors.ink} strokeWidth={2.5} />
  </View>
);

/** White remove badge that hangs off the top-right of a logo or photo. */
export const RemoveBadge = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable
    className="z-10 h-6 w-6 items-center justify-center rounded-full bg-white"
    style={{ position: 'absolute', top: -8, right: -8 }}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
  >
    <TrashIcon color={muteColor(colors.muted)} />
  </Pressable>
);

/**
 * Upload, replace, and remove one image stored on the team theme, such as the logo.
 *
 * @param options.teamId - The team being edited.
 * @param options.themePatch - The theme fields to send for a new key, or for `undefined` on remove.
 * @param options.onSaved - Receives the saved theme.
 * @returns The current error message and the upload and clear actions.
 */
export const useTeamImageSetting = ({
  teamId,
  themePatch,
  onSaved,
}: {
  teamId: string;
  themePatch: (key: string | undefined) => NonNullable<UpdateTeamBody['theme']>;
  onSaved: (theme: TeamTheme | undefined) => void;
}): { error: string | undefined; upload: () => Promise<void>; clear: () => void } => {
  const { t } = useTranslation();
  const { api, patchTeam } = useApp();
  const [error, setError] = useState<string | undefined>();

  const save = async (key: string | undefined): Promise<void> => {
    const saved = await api.updateTeam(teamId, { theme: themePatch(key) });
    patchTeam(saved);
    onSaved(saved.theme);
  };

  const upload = async (): Promise<void> => {
    setError(undefined);
    const result = await pickAndUploadImage(api);
    if (result === undefined) return;
    if ('error' in result) {
      setError(t(teamImageErrorKey(result.error)));
      return;
    }
    try {
      await save(result.key);
    } catch {
      setError(t('errors.teamAdmin.logoUploadFailed'));
    }
  };

  const clear = (): void => {
    setError(undefined);
    void save(undefined).catch(() => setError(t('errors.teamAdmin.logoUploadFailed')));
  };

  return { error, upload, clear };
};
