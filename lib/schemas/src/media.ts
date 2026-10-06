/**
 * Media upload and download wire contracts, plus device-token registration.
 */

import { devicePlatformSchema } from './enums.js';
import { MAX_UPLOAD_BYTES } from './limits.js';
import { z } from './zod.js';

/** Body for requesting a presigned upload URL. */
export const presignUploadBodySchema = z
  .object({
    contentType: z.string().min(1).max(128),
    contentLength: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  })
  .strict();

/** Response with a short-lived upload URL and the object key to store on the message. */
export const presignUploadResponseSchema = z.object({
  uploadUrl: z.string().min(1),
  objectKey: z.string().min(1),
  maxBytes: z.literal(MAX_UPLOAD_BYTES),
});

/** Query for a short-lived download URL. */
export const presignDownloadQuerySchema = z.object({
  objectKey: z.string().min(1).max(512),
});

/** Response with a short-lived download URL. */
export const presignDownloadResponseSchema = z.object({
  downloadUrl: z.string().min(1),
  objectKey: z.string().min(1),
});

/** Body for registering or replacing a push device token. */
export const registerDeviceBodySchema = z
  .object({
    token: z.string().min(1).max(4096),
    platform: devicePlatformSchema,
  })
  .strict();

/** Inferred type for {@link presignUploadBodySchema}. */
export type PresignUploadBody = z.infer<typeof presignUploadBodySchema>;

/** Inferred type for {@link presignUploadResponseSchema}. */
export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>;

/** Inferred type for {@link presignDownloadQuerySchema}. */
export type PresignDownloadQuery = z.infer<typeof presignDownloadQuerySchema>;

/** Inferred type for {@link presignDownloadResponseSchema}. */
export type PresignDownloadResponse = z.infer<typeof presignDownloadResponseSchema>;

/** Inferred type for {@link registerDeviceBodySchema}. */
export type RegisterDeviceBody = z.infer<typeof registerDeviceBodySchema>;
