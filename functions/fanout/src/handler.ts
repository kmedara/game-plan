/**
 * Fan-out area Lambda.
 *
 * Dispatches SQS batches to the consumer route. HTTP covers health and the
 * local deliver route used when the queue is not running on the laptop.
 */

import type { APIGatewayProxyStructuredResultV2, SQSBatchResponse } from 'aws-lambda';
import { handleHealth, isHttpEvent, isSqsEvent, notFound } from '../../lib/http.js';
import { handleDeliver, handleSqs } from './routes/index.js';

/**
 * Normalizes a path to the fan-out route suffix.
 *
 * @param path - The raw request path.
 * @returns The route key without a leading slash.
 */
const routeOf = (path: string): string => {
  const normalized = path.replace(/\/+$/u, '') || '/';
  if (normalized === '/fanout' || normalized === '/') return '';
  if (normalized.startsWith('/fanout/')) return normalized.slice('/fanout/'.length);
  if (normalized.startsWith('/')) return normalized.slice(1);
  return normalized;
};

/**
 * Handles Amazon Simple Queue Service (SQS) batches and HTTP health checks.
 *
 * @param event - An SQS event or an HTTP API event.
 * @returns An empty batch failure list, a health response, or `404`.
 */
export const handler = async (
  event: unknown,
): Promise<APIGatewayProxyStructuredResultV2 | SQSBatchResponse> => {
  if (isSqsEvent(event)) return handleSqs(event);
  if (!isHttpEvent(event)) return notFound();

  const path = event.rawPath ?? '';
  const method = event.requestContext.http.method;

  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return handleHealth(event, 'fanout');
  }

  const route = routeOf(path);
  if (method === 'POST' && route === 'deliver') return handleDeliver(event);

  return notFound();
};
