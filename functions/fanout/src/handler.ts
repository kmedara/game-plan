/**
 * Fan-out area Lambda.
 *
 * Dispatches SQS batches to the consumer route. HTTP covers health and the
 * local deliver route used when the queue is not running on the laptop.
 */

import type { APIGatewayProxyStructuredResultV2, SQSBatchResponse } from 'aws-lambda';
import { handleHealth, isHttpEvent, isSqsEvent, notFound } from '../../lib/http.js';
import { dispatch } from '../../lib/pipeline.js';
import { handleSqs, httpRoutes } from './routes/index.js';

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

  return dispatch(httpRoutes, event);
};
