/**
 * Image upload and download helpers shared by every screen that shows stored media.
 */

import { useQuery } from '@tanstack/react-query';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { PresignDownloadQuery, PresignUploadBody } from '@gameplan/types';
import { downloadQuery } from './queries/media';
import { useApp } from './state';

/** Largest image the app uploads. The media API allows more; this keeps phone uploads quick. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

type UploadImageType = PresignUploadBody['contentType'];

/** Types the media API accepts. Anything else, such as HEIC, is re-encoded as JPEG first. */
const UPLOAD_IMAGE_TYPES: ReadonlySet<string> = new Set<UploadImageType>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

/** JPEG quality for a re-encoded image when the caller gives none. */
const CONVERT_QUALITY = 0.85;

const isUploadImageType = (type: string): type is UploadImageType => UPLOAD_IMAGE_TYPES.has(type);

/**
 * The picked image as a type the media API accepts, no larger than `maxDimension`.
 *
 * @param asset - The picked file, its reported type, and its size in pixels.
 * @param quality - JPEG quality for a re-encode.
 * @param maxDimension - Longest side allowed, in pixels. Omit to keep the original size.
 * @returns The original when its type and size are accepted, otherwise a re-encoded copy.
 */
const uploadableImage = async (
  asset: { uri: string; mimeType?: string | null; width: number; height: number },
  quality: number,
  maxDimension: number | undefined,
): Promise<{ uri: string; contentType: UploadImageType }> => {
  const type = asset.mimeType ?? 'image/jpeg';
  const longest = Math.max(asset.width, asset.height);
  const shrink = maxDimension !== undefined && longest > maxDimension;
  if (isUploadImageType(type) && !shrink) return { uri: asset.uri, contentType: type };
  const context = ImageManipulator.manipulate(asset.uri);
  if (shrink) {
    context.resize(asset.width >= asset.height ? { width: maxDimension } : { height: maxDimension });
  }
  const image = await context.renderAsync();
  // PNG keeps transparency; everything else, including a GIF's first frame, becomes JPEG.
  if (type === 'image/png') {
    const saved = await image.saveAsync({ format: SaveFormat.PNG });
    return { uri: saved.uri, contentType: 'image/png' };
  }
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
  return { uri: saved.uri, contentType: 'image/jpeg' };
};

/** Longest side of a stored profile photo. Avatars show at 96px or less, so 512 stays sharp on 3x screens. */
export const PROFILE_PHOTO_MAX_DIMENSION = 512;

/**
 * Longest side of a chat photo. Sharp full screen on phones and most laptop screens,
 * and a typical photo stays well under 1 MB.
 */
export const CHAT_PHOTO_MAX_DIMENSION = 2048;

export type ImageUploadFailure = 'bad_type' | 'too_large' | 'upload_failed';

/** An uploaded image: the stored object key and the local URI for an instant preview. */
export type UploadedImage = { key: string; uri: string };

export type ImageUploadOptions = {
  /** Allowed MIME types, checked after any re-encode. Omit to accept every type the API takes. */
  types?: ReadonlySet<string>;
  /** Defaults to {@link IMAGE_MAX_BYTES}. */
  maxBytes?: number;
  /** Picker re-encode quality from 0 to 1. Omit to keep the original file. */
  quality?: number;
  /** Longest side in pixels. Larger images are scaled down before upload. */
  maxDimension?: number;
};

type Uploader = {
  presignUpload: (contentType: UploadImageType, bytes: number) => Promise<{ uploadUrl: string; objectKey: string }>;
};

/**
 * Opens the image library and uploads the selection through a presigned URL.
 *
 * Types the media API does not take, such as HEIC, are re-encoded as JPEG.
 * With `maxDimension`, larger images are scaled down first.
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
  try {
    const { uri, contentType } = await uploadableImage(asset, options.quality ?? CONVERT_QUALITY, options.maxDimension);
    if (options.types !== undefined && !options.types.has(contentType)) return { error: 'bad_type' };
    const blob = await (await fetch(uri)).blob();
    if (blob.size > (options.maxBytes ?? IMAGE_MAX_BYTES)) return { error: 'too_large' };
    const presign = await api.presignUpload(contentType, blob.size);
    const response = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: blob,
    });
    if (!response.ok) return { error: 'upload_failed' };
    return { key: presign.objectKey, uri };
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
