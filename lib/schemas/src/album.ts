/**
 * Team album wire contracts: photos and, on a paid plan, videos.
 *
 * An album file is uploaded through a signed URL like any other upload, then
 * added to the album, which checks the team's plan and storage before it counts.
 */

import { MAX_ALBUM_VIDEO_BYTES, MAX_UPLOAD_BYTES } from './limits.js';
import { UPLOAD_IMAGE_TYPES } from './media.js';
import { z } from './zod.js';

/**
 * Video types an album upload may declare.
 *
 * MP4 plays everywhere. QuickTime is what iPhones record. WebM is what browsers record.
 */
export const UPLOAD_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

/** Every type an album upload may declare. */
export const albumContentTypeSchema = z.enum([...UPLOAD_IMAGE_TYPES, ...UPLOAD_VIDEO_TYPES]);

/** Inferred type for {@link albumContentTypeSchema}. */
export type AlbumContentType = z.infer<typeof albumContentTypeSchema>;

/** Whether an album item is a still or a clip. */
export const ALBUM_ITEM_KINDS = ['photo', 'video'] as const;

/** Schema for {@link ALBUM_ITEM_KINDS}. */
export const albumItemKindSchema = z.enum(ALBUM_ITEM_KINDS);

/** Inferred type for {@link albumItemKindSchema}. */
export type AlbumItemKind = z.infer<typeof albumItemKindSchema>;

/** Longest clip length any request may state. Plan limits are lower. */
const MAX_STATED_SECONDS = 24 * 60 * 60;

/** Pixel size of a photo or video frame, as the picker reported it. */
const dimension = z.number().int().min(1).max(100_000);

/**
 * Body for `POST /media/teams/:teamId/album/uploads`.
 *
 * Photos keep the usual upload cap. A video's length is stated by the app,
 * which reads it from the picked file; the API checks it against the plan.
 */
export const albumUploadBodySchema = z
  .object({
    contentType: albumContentTypeSchema,
    contentLength: z.number().int().min(1).max(MAX_ALBUM_VIDEO_BYTES),
    durationSeconds: z.number().min(0).max(MAX_STATED_SECONDS).optional(),
  })
  .strict()
  .refine((body) => body.contentType.startsWith('video/') || body.contentLength <= MAX_UPLOAD_BYTES, {
    message: 'photo_too_large',
    path: ['contentLength'],
  })
  .refine((body) => !body.contentType.startsWith('video/') || body.durationSeconds !== undefined, {
    message: 'duration_required',
    path: ['durationSeconds'],
  });

/** Inferred type for {@link albumUploadBodySchema}. */
export type AlbumUploadBody = z.infer<typeof albumUploadBodySchema>;

/** A signed URL for one album file. The key goes back in {@link addAlbumItemBodySchema}. */
export const albumUploadResponseSchema = z.object({
  uploadUrl: z.string().min(1),
  objectKey: z.string().min(1),
});

/** Inferred type for {@link albumUploadResponseSchema}. */
export type AlbumUploadResponse = z.infer<typeof albumUploadResponseSchema>;

/** Body for `POST /media/teams/:teamId/album`, after the file is uploaded. */
export const addAlbumItemBodySchema = z
  .object({
    objectKey: z.string().min(1).max(512),
    durationSeconds: z.number().min(0).max(MAX_STATED_SECONDS).optional(),
    width: dimension.optional(),
    height: dimension.optional(),
  })
  .strict();

/** Inferred type for {@link addAlbumItemBodySchema}. */
export type AddAlbumItemBody = z.infer<typeof addAlbumItemBodySchema>;

/** One photo or video in a team's album. */
export const albumItemSchema = z
  .object({
    itemId: z.string().min(1),
    teamId: z.string().min(1),
    objectKey: z.string().min(1),
    kind: albumItemKindSchema,
    contentType: albumContentTypeSchema,
    /** Stored size, read from the uploaded file. */
    bytes: z.number().int().min(1),
    durationSeconds: z.number().min(0).optional(),
    width: dimension.optional(),
    height: dimension.optional(),
    uploadedBy: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();

/** Inferred type for {@link albumItemSchema}. */
export type AlbumItem = z.infer<typeof albumItemSchema>;

/** Query for `GET /media/teams/:teamId/album`. */
export const albumListQuerySchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
});

/** Inferred type for {@link albumListQuerySchema}. */
export type AlbumListQuery = z.infer<typeof albumListQuerySchema>;

/** One page of a team's album, newest first, with the storage the album uses. */
export const albumPageSchema = z
  .object({
    teamId: z.string().min(1),
    items: z.array(albumItemSchema),
    /** Bytes every item in the album takes, counted against the plan. */
    usedBytes: z.number().int().min(0),
    cursor: z.string().min(1).optional(),
  })
  .strict();

/** Inferred type for {@link albumPageSchema}. */
export type AlbumPage = z.infer<typeof albumPageSchema>;
