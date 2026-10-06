/**
 * Presign upload and download routes.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { presignDownloadQuerySchema, presignUploadBodySchema } from '@gameplan/schemas';
import { json, withBodyValidation, withQueryValidation } from '../../../lib/http.js';
import { requireUser } from '../../../lib/auth/index.js';

import { createDownloadUrl, createUploadUrl } from '../media-store.js';

import { withMediaErrors } from './errors.js';

/**
 * Handles `POST /media/presign-upload`.
 *
 * @param event - The HTTP API event.
 * @returns A short-lived upload URL and object key.
 */
export const handlePresignUpload = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withMediaErrors(async () =>
    withBodyValidation(presignUploadBodySchema, async (event, body) => {
      const user = await requireUser(event);
      const result = await createUploadUrl(user.userId, body);
      return json(200, result);
    })(event),
  );

/**
 * Handles `GET /media/presign-download`.
 *
 * @param event - The HTTP API event.
 * @returns A short-lived download URL.
 */
export const handlePresignDownload = (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withMediaErrors(async () =>
    withQueryValidation(presignDownloadQuerySchema, async (event, query) => {
      await requireUser(event);
      const result = await createDownloadUrl(query.objectKey);
      return json(200, result);
    })(event),
  );
