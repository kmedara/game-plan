/**
 * Removes uploaded files from the media bucket.
 */

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

let s3: S3Client | undefined;

/**
 * Deletes one object from the media bucket. Does nothing when no bucket is configured.
 *
 * @param key - The object key.
 */
export const deleteMediaObject = async (key: string): Promise<void> => {
  const bucket = process.env.MEDIA_BUCKET;
  if (bucket === undefined || bucket === '') return;
  s3 ??= new S3Client({});
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};
