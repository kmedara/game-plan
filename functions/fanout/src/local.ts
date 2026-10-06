/**
 * Local entry for the fan-out area process.
 *
 * The cloud function also consumes Amazon Simple Queue Service (SQS). Local HTTP only
 * exposes the health route for this area.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { serveHttp } from '../../../local/src/serve-http.js';
import { areaPort } from '../../lib/names.js';
import { handler } from './handler.js';

/** Loopback port for the fan-out process. */
const port = Number(process.env.PORT ?? areaPort('fanout'));

serveHttp(port, async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const result = await handler(event);
  if (!('statusCode' in result)) {
    throw new Error('fan-out HTTP handler returned a queue result');
  }
  return result;
});
