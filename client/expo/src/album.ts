/**
 * Wording for the team album: storage sizes, clip lengths, and why a file was not added.
 */

import type { AlbumUploadFailure } from './media';

/** One gibibyte, the unit plan storage is sold in. */
const GIB = 1024 * 1024 * 1024;

/** One mebibyte. */
const MIB = 1024 * 1024;

/**
 * A storage size the way the plans screen states it: GB, or MB below one.
 *
 * @param bytes - The size.
 * @param locale - The app language, for the decimal mark.
 * @returns Such as `1.2 GB` or `340 MB`.
 */
export const formatStorage = (bytes: number, locale: string): string => {
  if (bytes >= GIB) {
    const value = bytes / GIB;
    const digits = value >= 10 || Number.isInteger(value) ? 0 : 1;
    return `${value.toLocaleString(locale, { maximumFractionDigits: digits })} GB`;
  }
  return `${Math.ceil(bytes / MIB).toLocaleString(locale)} MB`;
};

/**
 * A clip length as `m:ss`.
 *
 * @param seconds - The length.
 * @returns Such as `2:05`.
 */
export const formatClipLength = (seconds: number): string => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Translation keys by failure. */
const FAILURE_KEYS: Readonly<Record<AlbumUploadFailure, string>> = {
  bad_type: 'errors.album.badType',
  too_large: 'errors.album.tooLarge',
  upload_failed: 'errors.album.uploadFailed',
  plan_required: 'errors.album.planRequired',
  plan_limit_reached: 'errors.album.storageFull',
  video_too_large: 'errors.album.videoTooLarge',
  video_too_long: 'errors.album.videoTooLong',
};

/**
 * Translation key for why one album file was not added.
 *
 * @param failure - The failure.
 * @returns A catalog key.
 */
export const albumFailureKey = (failure: AlbumUploadFailure): string => FAILURE_KEYS[failure];
