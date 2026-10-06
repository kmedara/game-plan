/**
 * Local HTTP deliver route used when SQS is not running on the laptop.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { badRequest, parseJsonBody } from '../../../lib/http.js';
import { deliverFanoutJob, parseFanoutJob } from '../deliver.js';

/**
 * Handles `POST /fanout/deliver`.
 *
 * @param event - The HTTP API event.
 * @returns `204` on success, or `400` for a bad body.
 */
export const handleDeliver = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const body = parseJsonBody(event);
  const job = parseFanoutJob(body);
  if (job === undefined) return badRequest('invalid_body');
  await deliverFanoutJob(job);
  return { statusCode: 204 };
};
