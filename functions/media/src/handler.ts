/**
 * Media area Lambda.
 *
 * Presigned Amazon Simple Storage Service (S3) upload and download, device
 * token registration for offline push, and a local object store for laptop work.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handleHealth, notFound } from '../../lib/http.js';
import {
  handleDeleteDevice,
  handleLocalGetObject,
  handleLocalPutObject,
  handlePresignDownload,
  handlePresignUpload,
  handleRegisterDevice,
} from './routes/index.js';

/**
 * Normalizes a path to the media route suffix.
 *
 * @param path - The raw request path.
 * @returns The route key without a leading slash.
 */
const routeOf = (path: string): string => {
  const normalized = path.replace(/\/+$/u, '') || '/';
  if (normalized === '/media' || normalized === '/') return '';
  if (normalized.startsWith('/media/')) return normalized.slice('/media/'.length);
  if (normalized.startsWith('/')) return normalized.slice(1);
  return normalized;
};

/**
 * Handles HTTP requests for the media area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const path = event.rawPath ?? '';
  const method = event.requestContext.http.method;

  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return handleHealth(event, 'media');
  }

  const route = routeOf(path);
  const parts = route.length === 0 ? [] : route.split('/');

  if (method === 'POST' && parts.length === 1 && parts[0] === 'presign-upload') {
    return handlePresignUpload(event);
  }

  if (method === 'GET' && parts.length === 1 && parts[0] === 'presign-download') {
    return handlePresignDownload(event);
  }

  if (parts.length === 2 && parts[0] === 'devices') {
    const deviceId = decodeURIComponent(parts[1] ?? '');
    if (method === 'PUT') return handleRegisterDevice(event, deviceId);
    if (method === 'DELETE') return handleDeleteDevice(event, deviceId);
  }

  if (parts.length >= 2 && parts[0] === 'local-objects') {
    const objectKey = decodeURIComponent(parts.slice(1).join('/'));
    if (method === 'PUT') return handleLocalPutObject(event, objectKey);
    if (method === 'GET') return handleLocalGetObject(event, objectKey);
  }

  return notFound();
};
