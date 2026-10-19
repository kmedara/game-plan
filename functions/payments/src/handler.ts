/**
 * Payments area Lambda.
 *
 * Team dues through Stripe Connect: onboarding, charges, checkout, the Stripe
 * webhook, and the daily dues-reminder sweep.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { serveHttp } from '../../lib/pipeline.js';
import { runDuePaymentReminders } from './reminders.js';
import { httpRoutes } from './routes/index.js';

/**
 * Handles HTTP requests for the payments area.
 *
 * @param event - The Amazon API Gateway HTTP API event.
 * @returns A route response, health check, or `404`.
 */
const httpHandler = serveHttp('payments', httpRoutes);

/**
 * Handles HTTP requests and the daily reminder sweep from EventBridge.
 *
 * @param event - An HTTP API event, or `{ source: 'gameplan.payment-reminders' }`.
 * @returns The HTTP response, or an empty 200 after a sweep.
 */
export const handler = async (
  event: APIGatewayProxyEventV2 | { source?: string },
): Promise<APIGatewayProxyStructuredResultV2> => {
  if ('source' in event && event.source === 'gameplan.payment-reminders' && !('requestContext' in event)) {
    await runDuePaymentReminders(new Date());
    return { statusCode: 200, body: '' };
  }
  return httpHandler(event as APIGatewayProxyEventV2);
};
