/**
 * Schedule area Lambda.
 *
 * Dispatches practices, games, recurrence expansion, and per-occurrence RSVP.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { serveHttp } from '../../lib/pipeline.js';
import { runDueReminders } from './reminders.js';
import { httpRoutes } from './routes/index.js';

/**
 * Handles HTTP requests for the schedule area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
const httpHandler = serveHttp('schedule', httpRoutes);

/**
 * Handles API Gateway requests and the reminder sweep from EventBridge.
 *
 * @param event - An HTTP API event, or `{ source: 'gameplan.reminders' }`.
 * @returns The HTTP response, or an empty 200 after a sweep.
 */
export const handler = async (
  event: APIGatewayProxyEventV2 | { source?: string },
): Promise<APIGatewayProxyStructuredResultV2> => {
  if ('source' in event && event.source === 'gameplan.reminders' && !('requestContext' in event)) {
    await runDueReminders(new Date());
    return { statusCode: 200, body: '' };
  }
  return httpHandler(event as APIGatewayProxyEventV2);
};
