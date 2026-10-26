/**
 * Shared numeric limits used by schemas and clients.
 */

/** Default upload size cap for message attachments (15 MiB). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Largest album video any plan allows (1 GiB). The team's plan may allow less or none. */
export const MAX_ALBUM_VIDEO_BYTES = 1024 * 1024 * 1024;
