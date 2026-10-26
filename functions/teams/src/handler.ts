/**
 * Teams area Lambda.
 *
 * Dispatches create team, team settings, roster, invites, join requests, roles,
 * the permission matrix, and waivers, and runs the daily waiver-reminder sweep.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { serveHttp } from '../../lib/pipeline.js';
import { httpRoutes } from './routes/index.js';
import { runDueWaiverReminders } from './waiver-reminders.js';

/**
 * Handles HTTP requests for the teams area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
const httpHandler = serveHttp('teams', httpRoutes);

/**
 * Handles HTTP requests and the daily waiver-reminder sweep from EventBridge.
 *
 * @param event - An HTTP API event, or `{ source: 'gameplan.waiver-reminders' }`.
 * @returns The HTTP response, or an empty 200 after a sweep.
 */
export const handler = async (
  event: APIGatewayProxyEventV2 | { source?: string },
): Promise<APIGatewayProxyStructuredResultV2> => {
  if ('source' in event && event.source === 'gameplan.waiver-reminders' && !('requestContext' in event)) {
    await runDueWaiverReminders(new Date());
    return { statusCode: 200, body: '' };
  }
  return httpHandler(event as APIGatewayProxyEventV2);
};
