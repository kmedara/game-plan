/**
 * Presigned Amazon Simple Storage Service (S3) URLs, with a local object store
 * for laptop work when DynamoDB Local is in use.
 */

import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MAX_UPLOAD_BYTES, type PresignUploadBody } from '@gameplan/schemas';

/** How long a presigned URL stays valid. */
const PRESIGN_EXPIRES_SECONDS = 15 * 60;

/** In-memory object bytes for local uploads when S3 is not available. */
const localObjects = new Map<string, { contentType: string; body: Buffer }>();

/** Lazily created S3 client. */
let s3Client: S3Client | undefined;

/**
 * Returns whether this process should use the local object store.
 *
 * @returns `true` when DynamoDB Local (or an explicit flag) is configured.
 */
export const isLocalMedia = (): boolean =>
  process.env.MEDIA_LOCAL === '1' ||
  (process.env.DYNAMODB_ENDPOINT !== undefined && process.env.DYNAMODB_ENDPOINT.length > 0);

/**
 * Returns the shared S3 client.
 *
 * @returns The S3 client.
 */
const getS3 = (): S3Client => {
  s3Client ??= new S3Client({});
  return s3Client;
};

/**
 * Resets the S3 client and local object map (tests only).
 */
export const resetMediaStore = (): void => {
  s3Client = undefined;
  localObjects.clear();
};

/**
 * Reads the media bucket name from the environment.
 *
 * @returns The bucket name.
 * @throws When `MEDIA_BUCKET` is unset.
 */
const mediaBucket = (): string => {
  const bucket = process.env.MEDIA_BUCKET;
  if (bucket === undefined || bucket.length === 0) {
    throw new Error('media_bucket_not_configured');
  }
  return bucket;
};

/**
 * Builds the public API origin used for local object URLs.
 *
 * @returns A base URL such as `http://127.0.0.1:3000`.
 */
const localApiOrigin = (): string =>
  process.env.MEDIA_PUBLIC_ORIGIN ?? 'http://127.0.0.1:3000';

/**
 * Creates a new object key under the caller's prefix.
 *
 * @param userId - The uploading user id.
 * @returns An opaque object key.
 */
export const newObjectKey = (userId: string): string =>
  `uploads/${userId}/${randomUUID()}`;

/**
 * Issues a short-lived upload URL and object key.
 *
 * @param userId - The caller who will own the object key prefix.
 * @param body - Content type and length from the client.
 * @returns Upload URL, object key, and the size cap.
 */
export const createUploadUrl = async (
  userId: string,
  body: PresignUploadBody,
): Promise<{ uploadUrl: string; objectKey: string; maxBytes: typeof MAX_UPLOAD_BYTES }> => {
  const objectKey = newObjectKey(userId);
  if (isLocalMedia()) {
    return {
      uploadUrl: `${localApiOrigin()}/media/local-objects/${encodeURIComponent(objectKey)}`,
      objectKey,
      maxBytes: MAX_UPLOAD_BYTES,
    };
  }

  const command = new PutObjectCommand({
    Bucket: mediaBucket(),
    Key: objectKey,
    ContentType: body.contentType,
    ContentLength: body.contentLength,
  });
  const uploadUrl = await getSignedUrl(getS3(), command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  });
  return { uploadUrl, objectKey, maxBytes: MAX_UPLOAD_BYTES };
};

/**
 * Issues a short-lived download URL for an existing object key.
 *
 * @param objectKey - The object key stored on a message.
 * @returns Download URL and object key.
 */
export const createDownloadUrl = async (
  objectKey: string,
): Promise<{ downloadUrl: string; objectKey: string }> => {
  if (objectKey.includes('..') || objectKey.startsWith('/')) {
    throw new Error('invalid_object_key');
  }
  if (isLocalMedia()) {
    return {
      downloadUrl: `${localApiOrigin()}/media/local-objects/${encodeURIComponent(objectKey)}`,
      objectKey,
    };
  }

  const command = new GetObjectCommand({
    Bucket: mediaBucket(),
    Key: objectKey,
  });
  const downloadUrl = await getSignedUrl(getS3(), command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  });
  return { downloadUrl, objectKey };
};

/**
 * Stores bytes in the local object map (laptop only).
 *
 * @param objectKey - The object key.
 * @param contentType - The content type header.
 * @param body - Raw file bytes.
 */
export const putLocalObject = (
  objectKey: string,
  contentType: string,
  body: Buffer,
): void => {
  if (body.byteLength > MAX_UPLOAD_BYTES) throw new Error('payload_too_large');
  localObjects.set(objectKey, { contentType, body });
};

/**
 * Reads bytes from the local object map.
 *
 * @param objectKey - The object key.
 * @returns The stored object, or `undefined`.
 */
export const getLocalObject = (
  objectKey: string,
): { contentType: string; body: Buffer } | undefined => localObjects.get(objectKey);
