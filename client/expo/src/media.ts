/**
 * Image upload and download helpers shared by every screen that shows stored media.
 */

import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import type { PresignDownloadQuery } from '@gameplan/types';
import { downloadQuery } from './queries/media';
import { useApp } from './state';

/** Largest image the app uploads. The media API allows more; this keeps phone uploads quick. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type ImageUploadFailure = 'bad_type' | 'too_large' | 'upload_failed';

/** An uploaded image: the stored object key and the local URI for an instant preview. */
export type UploadedImage = { key: string; uri: string };

export type ImageUploadOptions = {
  /** Allowed MIME types. Omit to accept whatever the picker returns. */
  types?: ReadonlySet<string>;
  /** Defaults to {@link IMAGE_MAX_BYTES}. */
  maxBytes?: number;
  /** Picker re-encode quality from 0 to 1. Omit to keep the original file. */
  quality?: number;
};

type Uploader = {
  presignUpload: (contentType: string, bytes: number) => Promise<{ uploadUrl: string; objectKey: string }>;
};

/**
 * Opens the image library and uploads the selection through a presigned URL.
 *
 * @param api - Anything that can presign an upload.
 * @param options - Type, size, and quality limits.
 * @returns The upload, a failure reason, or `undefined` when the picker is canceled.
 */
export const pickAndUploadImage = async (
  api: Uploader,
  options: ImageUploadOptions = {},
): Promise<UploadedImage | { error: ImageUploadFailure } | undefined> => {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    ...(options.quality !== undefined ? { quality: options.quality } : {}),
  });
  if (picked.canceled || picked.assets[0] === undefined) return undefined;
  const asset = picked.assets[0];
  const contentType = asset.mimeType ?? 'image/jpeg';
  if (options.types !== undefined && !options.types.has(contentType)) return { error: 'bad_type' };
  try {
    const blob = await (await fetch(asset.uri)).blob();
    if (blob.size > (options.maxBytes ?? IMAGE_MAX_BYTES)) return { error: 'too_large' };
    const presign = await api.presignUpload(contentType, blob.size);
    const response = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: blob,
    });
    if (!response.ok) return { error: 'upload_failed' };
    return { key: presign.objectKey, uri: asset.uri };
  } catch {
    return { error: 'upload_failed' };
  }
};

/** Where a stored object is shown. The media API checks the caller's access in that context. */
export type DownloadContext = Pick<PresignDownloadQuery, 'chatId' | 'userId' | 'teamId'>;

/**
 * Presigned download URL for a stored object.
 *
 * A response for a key that is no longer current is dropped, so switching teams or
 * leaving a screen never shows another object's image.
 *
 * @param key - The object key, or `undefined` when there is nothing to show.
 * @param context - The chat, team, or user the object belongs to.
 * @returns The URL once loaded, otherwise `undefined`.
 */
export const useDownloadUrl = (
  key: string | undefined,
  { chatId, userId, teamId }: DownloadContext = {},
): string | undefined => {
  const { api } = useApp();
  const context = {
    ...(chatId !== undefined ? { chatId } : {}),
    ...(userId !== undefined ? { userId } : {}),
    ...(teamId !== undefined ? { teamId } : {}),
  };
  const { data } = useQuery({
    ...downloadQuery(api, key ?? '', context),
    enabled: key !== undefined,
  });
  return data;
};
