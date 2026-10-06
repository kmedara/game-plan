/**
 * Health-check coverage for every area Lambda, plus socket connect and fan-out batches.
 */

import type { APIGatewayProxyEventV2, SQSEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler as chat } from './chat/src/handler.js';
import { handler as fanout } from './fanout/src/handler.js';
import { handler as identity } from './identity/src/handler.js';
import { handler as media } from './media/src/handler.js';
import { handler as places } from './places/src/handler.js';
import { handler as schedule } from './schedule/src/handler.js';
import { handler as socket } from './socket/src/handler.js';
import { handler as teams } from './teams/src/handler.js';

/** Area name and handler pairs exercised by the health suite. */
const httpHandlers = [
  ['identity', identity],
  ['teams', teams],
  ['schedule', schedule],
  ['chat', chat],
  ['media', media],
  ['places', places],
  ['socket', socket],
  ['fanout', fanout],
] as const;

/**
 * Builds a minimal Amazon API Gateway HTTP API event for a `GET` path.
 *
 * @param path - The request path, including the area prefix.
 * @returns An HTTP API event suitable for the area handlers.
 */
const httpEvent = (path: string): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    requestContext: { http: { method: 'GET', path } },
  }) as APIGatewayProxyEventV2;

describe('area health', () => {
  it.each(httpHandlers)('GET /%s/health', async (service, handler) => {
    const result = await handler(httpEvent(`/${service}/health`));
    if (!('statusCode' in result)) throw new Error('expected an HTTP result');
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toEqual({ ok: true, service });
  });

  it('returns 404 for an unknown GET path', async () => {
    const result = await identity(httpEvent('/identity/register'));
    expect(result.statusCode).toBe(404);
  });
});

describe('socket and fanout events', () => {
  it('rejects a websocket connect without a token', async () => {
    const result = await socket({
      requestContext: { routeKey: '$connect', connectionId: 'c1' },
    });
    expect(result.statusCode).toBe(401);
  });

  it('acknowledges an empty fan-out batch', async () => {
    const event = { Records: [{ eventSource: 'aws:sqs', body: '{}', messageId: 'm1' }] } as SQSEvent;
    const result = await fanout(event);
    expect(result).toEqual({ batchItemFailures: [] });
  });
});
