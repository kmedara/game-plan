/**
 * Local object store routes used when DynamoDB Local stands in for the cloud.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { headerOf, notFound } from '../../../lib/http.js';
import { getLocalObject, isLocalMedia, putLocalObject } from '../media-store.js';
import { withMediaErrors } from './errors.js';

/**
 * Handles `PUT /media/local-objects/:objectKey`.
 *
 * @param event - The HTTP API event.
 * @param objectKey - The decoded object key.
 * @returns `204` when stored, or `404` outside local mode.
 */
export const handleLocalPutObject = (
  event: APIGatewayProxyEventV2,
  objectKey: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withMediaErrors(async () => {
    if (!isLocalMedia()) return notFound();
    const raw = event.body ?? '';
    const body = event.isBase64Encoded
      ? Buffer.from(raw, 'base64')
      : Buffer.from(raw, 'binary');
    const contentType = headerOf(event, 'content-type') ?? 'application/octet-stream';
    putLocalObject(objectKey, contentType, body);
    return { statusCode: 204 };
  });

/**
 * Handles `GET /media/local-objects/:objectKey`.
 *
 * @param event - The HTTP API event.
 * @param objectKey - The decoded object key.
 * @returns The object bytes, or `404`.
 */
export const handleLocalGetObject = (
  event: APIGatewayProxyEventV2,
  objectKey: string,
): Promise<APIGatewayProxyStructuredResultV2> =>
  withMediaErrors(async () => {
    if (!isLocalMedia()) return notFound();
    const object = getLocalObject(objectKey);
    if (object === undefined) return notFound();
    return {
      statusCode: 200,
      headers: { 'content-type': object.contentType },
      body: object.body.toString('base64'),
      isBase64Encoded: true,
    };
  });
