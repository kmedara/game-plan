/**
 * Image upload and download helpers shared by every screen that shows stored media,
 * and the team album's photo and video upload.
 */

import { useQuery } from '@tanstack/react-query';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { albumUploadProblem, type AlbumUploadProblem, type PlanLimits } from '@gameplan/rules';
import {
  UPLOAD_VIDEO_TYPES,
  type AlbumItem,
  type AlbumUploadBody,
  type AlbumUploadResponse,
  type AddAlbumItemBody,
  type PresignDownloadQuery,
  type PresignUploadBody,
} from '@gameplan/types';
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

/** Most files one pick adds to the album. */
export const ALBUM_PICK_LIMIT = 20;

/** Why one album file was not added. */
export type AlbumUploadFailure = ImageUploadFailure | AlbumUploadProblem;

type AlbumUploader = {
  presignAlbumUpload: (teamId: string, body: AlbumUploadBody) => Promise<AlbumUploadResponse>;
  addAlbumItem: (teamId: string, body: AddAlbumItemBody) => Promise<AlbumItem>;
};

type VideoType = (typeof UPLOAD_VIDEO_TYPES)[number];

const isVideoType = (type: string): type is VideoType => (UPLOAD_VIDEO_TYPES as readonly string[]).includes(type);

/**
 * A video's length in seconds, from the picker or, on the website, from the file itself.
 *
 * @param asset - The picked video.
 * @returns The length, or `undefined` when it cannot be read.
 */
const videoSeconds = async (asset: ImagePicker.ImagePickerAsset): Promise<number | undefined> => {
  if (typeof asset.duration === 'number' && asset.duration > 0) return asset.duration / 1000;
  if (Platform.OS !== 'web') return undefined;
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? video.duration : undefined);
    video.onerror = () => resolve(undefined);
    video.src = asset.uri;
  });
};

/**
 * Codes the API returns for an album file, as {@link AlbumUploadFailure}s.
 *
 * @param err - What the add or presign request threw.
 * @returns The failure to show.
 */
const albumFailureOf = (err: unknown): AlbumUploadFailure => {
  const code = err instanceof Error ? err.message : '';
  if (
    code === 'plan_required' ||
    code === 'plan_limit_reached' ||
    code === 'video_too_large' ||
    code === 'video_too_long'
  ) {
    return code;
  }
  return 'upload_failed';
};

/**
 * Uploads one picked photo or video and adds it to the team album.
 *
 * Photos are scaled like chat photos. Videos go up as recorded once the plan's
 * size and length limits pass; the API checks the same limits again.
 */
const uploadAlbumAsset = async (
  api: AlbumUploader,
  teamId: string,
  asset: ImagePicker.ImagePickerAsset,
  limits: PlanLimits,
  usedBytes: number,
): Promise<AlbumItem | { error: AlbumUploadFailure }> => {
  const video = asset.type === 'video' || (asset.mimeType ?? '').startsWith('video/');
  let uri = asset.uri;
  let contentType: AlbumUploadBody['contentType'];
  let durationSeconds: number | undefined;
  if (video) {
    const type = asset.mimeType ?? 'video/mp4';
    if (!isVideoType(type)) return { error: 'bad_type' };
    contentType = type;
    durationSeconds = await videoSeconds(asset);
    if (durationSeconds === undefined) return { error: 'upload_failed' };
  } else {
    const image = await uploadableImage(asset, CONVERT_QUALITY, CHAT_PHOTO_MAX_DIMENSION);
    uri = image.uri;
    contentType = image.contentType;
  }
  const blob = await (await fetch(uri)).blob();
  if (!video && blob.size > IMAGE_MAX_BYTES) return { error: 'too_large' };
  const upload = { contentType, bytes: blob.size, ...(durationSeconds !== undefined ? { durationSeconds } : {}) };
  const problem = albumUploadProblem(limits, usedBytes, upload);
  if (problem !== undefined) return { error: problem };
  try {
    const presign = await api.presignAlbumUpload(teamId, {
      contentType,
      contentLength: blob.size,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    });
    const response = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: blob,
    });
    if (!response.ok) return { error: 'upload_failed' };
    return await api.addAlbumItem(teamId, {
      objectKey: presign.objectKey,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(asset.width > 0 ? { width: Math.round(asset.width) } : {}),
      ...(asset.height > 0 ? { height: Math.round(asset.height) } : {}),
    });
  } catch (err) {
    return { error: albumFailureOf(err) };
  }
};

/**
 * Opens the library and adds the picked photos, and videos when the plan has them, to the team album.
 *
 * Files go up one at a time so each counts against the storage the last one left.
 *
 * @param api - Anything that can sign and add album uploads.
 * @param teamId - The team whose album gets the files.
 * @param options - The team's plan limits and the bytes the album already holds.
 * @param onProgress - Called before each file with its position and the total.
 * @returns What was added and why the rest were not, or `undefined` when the picker is canceled.
 */
export const pickAndUploadAlbumFiles = async (
  api: AlbumUploader,
  teamId: string,
  options: { limits: PlanLimits; usedBytes: number },
  onProgress?: (done: number, total: number) => void,
): Promise<{ added: AlbumItem[]; failures: AlbumUploadFailure[] } | undefined> => {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: options.limits.video ? ['images', 'videos'] : ['images'],
    allowsMultipleSelection: true,
    selectionLimit: ALBUM_PICK_LIMIT,
  });
  if (picked.canceled || picked.assets.length === 0) return undefined;
  const added: AlbumItem[] = [];
  const failures: AlbumUploadFailure[] = [];
  let usedBytes = options.usedBytes;
  for (const [index, asset] of picked.assets.entries()) {
    onProgress?.(index, picked.assets.length);
    try {
      const result = await uploadAlbumAsset(api, teamId, asset, options.limits, usedBytes);
      if ('error' in result) {
        failures.push(result.error);
      } else {
        added.push(result);
        usedBytes += result.bytes;
      }
    } catch {
      failures.push('upload_failed');
    }
  }
  return { added, failures };
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
