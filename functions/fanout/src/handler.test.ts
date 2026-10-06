/**
 * Fan-out Lambda HTTP and SQS routing coverage.
 */

import type { APIGatewayProxyEventV2, SQSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deliverFanoutJob = vi.fn();

vi.mock('./deliver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./deliver.js')>();
  return {
    ...actual,
    deliverFanoutJob: (...args: unknown[]) => deliverFanoutJob(...args),
  };
});

const { handler } = await import('./handler.js');

/**
 * Builds a minimal HTTP API event for fan-out routes.
 *
 * @param method - The HTTP method.
 * @param path - The request path.
 * @param body - Optional JSON body.
 * @returns An HTTP API event.
 */
const httpEvent = (
  method: string,
  path: string,
  body?: unknown,
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

const validChatJob = {
  type: 'chat_message',
  chatId: 'c1',
  messageId: 'm1',
  senderId: 'u1',
  body: 'hi',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('fanout handler HTTP', () => {
  beforeEach(() => {
    deliverFanoutJob.mockReset();
    deliverFanoutJob.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns health for GET /fanout/health', async () => {
    const result = await handler(httpEvent('GET', '/fanout/health'));
    expect(result).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(String(result.body))).toEqual({ ok: true, service: 'fanout' });
  });

  it('returns health for GET /health', async () => {
    const result = await handler(httpEvent('GET', '/health'));
    expect(result.statusCode).toBe(200);
  });

  it('delivers on POST /fanout/deliver', async () => {
    const result = await handler(httpEvent('POST', '/fanout/deliver', validChatJob));
    expect(result.statusCode).toBe(204);
    expect(deliverFanoutJob).toHaveBeenCalledWith(validChatJob);
  });

  it('returns 400 for an invalid deliver body', async () => {
    const result = await handler(httpEvent('POST', '/fanout/deliver', { type: 'nope' }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(String(result.body))).toEqual({ error: 'invalid_body' });
    expect(deliverFanoutJob).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown HTTP route', async () => {
    const result = await handler(httpEvent('GET', '/fanout/unknown'));
    expect(result.statusCode).toBe(404);
  });

  it('treats a missing rawPath as empty', async () => {
    const event = {
      version: '2.0',
      requestContext: { http: { method: 'POST', path: '/fanout/deliver' } },
      body: JSON.stringify(validChatJob),
    } as APIGatewayProxyEventV2;
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
  });

  it('returns 404 for POST on bare /fanout', async () => {
    const result = await handler(httpEvent('POST', '/fanout', validChatJob));
    expect(result.statusCode).toBe(404);
  });

  it('delivers on POST /fanout/deliver/ with a trailing slash', async () => {
    const result = await handler(httpEvent('POST', '/fanout/deliver/', validChatJob));
    expect(result.statusCode).toBe(204);
    expect(deliverFanoutJob).toHaveBeenCalled();
  });

  it('delivers on POST /deliver without the /fanout prefix', async () => {
    const result = await handler(httpEvent('POST', '/deliver', validChatJob));
    expect(result.statusCode).toBe(204);
    expect(deliverFanoutJob).toHaveBeenCalled();
  });

  it('delivers on POST when the path has no leading slash', async () => {
    const result = await handler(httpEvent('POST', 'deliver', validChatJob));
    expect(result.statusCode).toBe(204);
    expect(deliverFanoutJob).toHaveBeenCalled();
  });

  it('returns 404 for POST on root path', async () => {
    const result = await handler(httpEvent('POST', '/', validChatJob));
    expect(result.statusCode).toBe(404);
  });
});

describe('fanout handler SQS', () => {
  beforeEach(() => {
    deliverFanoutJob.mockReset();
    deliverFanoutJob.mockResolvedValue(undefined);
  });

  it('warns and continues on an invalid job body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const event = {
      Records: [
        {
          eventSource: 'aws:sqs',
          body: JSON.stringify({ type: 'nope' }),
          messageId: 'bad-1',
        },
      ],
    } as SQSEvent;

    const result = await handler(event);

    expect(result).toEqual({ batchItemFailures: [] });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"event":"invalid_job"'),
    );
    expect(deliverFanoutJob).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('delivers a valid SQS record', async () => {
    const event = {
      Records: [
        {
          eventSource: 'aws:sqs',
          body: JSON.stringify(validChatJob),
          messageId: 'ok-1',
        },
      ],
    } as SQSEvent;

    const result = await handler(event);

    expect(result).toEqual({ batchItemFailures: [] });
    expect(deliverFanoutJob).toHaveBeenCalledWith(validChatJob);
  });

  it('reports batch item failures when delivery throws', async () => {
    deliverFanoutJob.mockRejectedValue(new Error('boom'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const event = {
      Records: [
        {
          eventSource: 'aws:sqs',
          body: JSON.stringify(validChatJob),
          messageId: 'fail-1',
        },
      ],
    } as SQSEvent;

    const result = await handler(event);

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'fail-1' }] });
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('"event":"deliver_failed"'),
    );
    errorLog.mockRestore();
  });

  it('stringifies non-Error delivery failures in the error log', async () => {
    deliverFanoutJob.mockRejectedValue('plain failure');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const event = {
      Records: [
        {
          eventSource: 'aws:sqs',
          body: JSON.stringify(validChatJob),
          messageId: 'fail-2',
        },
      ],
    } as SQSEvent;

    await handler(event);

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('"error":"plain failure"'),
    );
    errorLog.mockRestore();
  });
});

describe('fanout handler unknown events', () => {
  it('returns 404 for a non-HTTP non-SQS event', async () => {
    const result = await handler({ requestContext: { routeKey: '$connect' } });
    expect(result.statusCode).toBe(404);
  });
});
