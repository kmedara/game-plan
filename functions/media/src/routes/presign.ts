/**
 * Presign upload and download routes.
 */

import { presignDownloadQuerySchema, presignUploadBodySchema } from '@gameplan/schemas';
import { requireUser } from '../../../lib/auth/index.js';
import { json } from '../../../lib/http.js';
import { route, withBodyValidation, withQueryValidation } from '../../../lib/pipeline.js';
import { assertCanDownload } from '../download-access.js';
import { createDownloadUrl, createUploadUrl } from '../media-store.js';
import { withMediaErrors } from './errors.js';

/**
 * Handles `POST /media/presign-upload`.
 *
 * @param event - The HTTP API event.
 * @returns A short-lived upload URL and object key.
 */
export const handlePresignUpload = route(
  'POST',
  '/media/presign-upload',
  withMediaErrors(),
  requireUser(),
  withBodyValidation(presignUploadBodySchema),
  async ({ user, body }) => {
    const result = await createUploadUrl(user.userId, body);
    return json(200, result);
  },
);

/**
 * Handles `GET /media/presign-download`.
 *
 * @param event - The HTTP API event.
 * @returns A short-lived download URL.
 */
export const handlePresignDownload = route(
  'GET',
  '/media/presign-download',
  withMediaErrors(),
  requireUser(),
  withQueryValidation(presignDownloadQuerySchema),
  async ({ user, query }) => {
    await assertCanDownload(user.userId, query.objectKey, {
      ...(query.chatId !== undefined ? { chatId: query.chatId } : {}),
      ...(query.userId !== undefined ? { userId: query.userId } : {}),
      ...(query.teamId !== undefined ? { teamId: query.teamId } : {}),
    });
    const result = await createDownloadUrl(query.objectKey);
    return json(200, result);
  },
);
