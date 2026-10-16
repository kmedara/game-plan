/**
 * Shared team image upload and the trash control used under editable team settings.
 */

import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApp } from './state';
import { colors, muteColor } from './theme';

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export type TeamImageFailure = 'bad_type' | 'too_large' | 'upload_failed';

export type ChatBackgroundOverlay = 'dark' | 'light' | 'none';

/** Scrim drawn over a chat wallpaper. Missing means the dark scrim. */
export const chatOverlayColor = (overlay: ChatBackgroundOverlay | undefined): string | undefined => {
  if (overlay === 'none') return undefined;
  if (overlay === 'light') return 'rgba(255,255,255,0.55)';
  return 'rgba(0,0,0,0.45)';
};

/** Translation key for a failed team image upload. */
export const teamImageErrorKey = (error: TeamImageFailure): string => {
  if (error === 'bad_type') return 'errors.teamAdmin.badLogoType';
  if (error === 'too_large') return 'errors.teamAdmin.logoTooLarge';
  return 'errors.teamAdmin.logoUploadFailed';
};

/** Trash can. Defaults to the muted ink. Pass a color for a tinted can. */
export const TrashIcon = ({ color }: { color?: string }) => (
  <View className="h-4 w-4 items-center justify-center">
    <View className={`h-0.5 w-1.5 rounded-full ${color === undefined ? 'bg-muted' : ''}`} style={color === undefined ? undefined : { backgroundColor: color }} />
    <View className={`mt-px h-0.5 w-3.5 rounded-full ${color === undefined ? 'bg-muted' : ''}`} style={color === undefined ? undefined : { backgroundColor: color }} />
    <View
      className={`mt-px h-2 w-2.5 flex-row justify-evenly rounded-b-sm border-x border-b pt-px ${color === undefined ? 'border-muted' : ''}`}
      style={color === undefined ? undefined : { borderColor: color }}
    >
      <View className={`h-full w-px ${color === undefined ? 'bg-muted' : ''}`} style={color === undefined ? undefined : { backgroundColor: color }} />
      <View className={`h-full w-px ${color === undefined ? 'bg-muted' : ''}`} style={color === undefined ? undefined : { backgroundColor: color }} />
    </View>
  </View>
);

/** Plus shown inside an empty logo or background frame. */
export const AddMark = () => (
  <View className="h-9 w-9 items-center justify-center rounded-full border border-line">
    <View className="h-3.5 w-3.5 items-center justify-center">
      <View className="absolute h-0.5 w-3.5 rounded-full bg-ink" />
      <View className="absolute h-3.5 w-0.5 rounded-full bg-ink" />
    </View>
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

/** Download URL for a stored team image. Empty when there is no key. */
export const useTeamImageUrl = (teamId: string, key: string | undefined): string | undefined => {
  const { api } = useApp();
  const [uri, setUri] = useState<string | undefined>();

  useEffect(() => {
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
  }, [api, key, teamId]);

  return uri;
};

/**
 * Opens the image library and uploads the selection.
 *
 * @returns The stored object key, or undefined when the picker is canceled.
 */
export const uploadTeamImage = async (
  api: {
    presignUpload: (contentType: string, bytes: number) => Promise<{ uploadUrl: string; objectKey: string }>;
  },
): Promise<{ key: string } | { error: TeamImageFailure } | undefined> => {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
  if (picked.canceled || picked.assets[0] === undefined) return undefined;
  const asset = picked.assets[0];
  const contentType = asset.mimeType ?? 'image/jpeg';
  if (!IMAGE_TYPES.has(contentType)) return { error: 'bad_type' };
  const blob = await (await fetch(asset.uri)).blob();
  if (blob.size > MAX_BYTES) return { error: 'too_large' };
  try {
    const presign = await api.presignUpload(contentType, blob.size);
    const uploadResponse = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: blob,
    });
    if (!uploadResponse.ok) return { error: 'upload_failed' };
    return { key: presign.objectKey };
  } catch {
    return { error: 'upload_failed' };
  }
};
