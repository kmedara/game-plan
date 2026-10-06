/**
 * Media Lambda coverage for presign and device token routes.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import { TABLE_PK, TABLE_SK } from '../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();

const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

vi.mock('../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(
    pk: string,
    sk: string,
  ): Promise<T | undefined> => store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
  },
  deleteItem: async (pk: string, sk: string): Promise<void> => {
    store.delete(itemKey(pk, sk));
  },
  queryBySkPrefix: async <T extends Record<string, unknown>>(
    pk: string,
    skPrefix: string,
  ): Promise<T[]> => {
    const items: T[] = [];
    for (const [key, item] of store) {
      const [itemPk, itemSk] = key.split('\0');
      if (itemPk === pk && itemSk.startsWith(skPrefix)) items.push(item as T);
    }
    return items;
  },
}));

process.env.DYNAMODB_ENDPOINT = 'http://127.0.0.1:8000';
process.env.MEDIA_BUCKET = 'gameplan-media-local';
process.env.MEDIA_PUBLIC_ORIGIN = 'http://127.0.0.1:3000';

const { handler } = await import('./handler.js');
const { resetMediaStore } = await import('./media-store.js');

/**
 * Builds a minimal HTTP API event for media routes.
 *
 * @param method - The HTTP method.
 * @param path - The request path, including `/media`.
 * @param options - Optional body, headers, and query.
 * @returns An HTTP API event.
 */
const httpEvent = (
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    rawBody?: string;
    isBase64Encoded?: boolean;
  } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.headers ?? {},
    queryStringParameters: options.query,
    body:
      options.rawBody !== undefined
        ? options.rawBody
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
    isBase64Encoded: options.isBase64Encoded ?? false,
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

describe('media handler', () => {
  beforeEach(() => {
    store.clear();
    resetMediaStore();
  });

  afterEach(() => {
    store.clear();
    resetMediaStore();
  });

  it('presigns a local upload URL', async () => {
    const userId = randomUUID();
    const { accessToken } = issueLocalTokens(userId, `${userId}@example.com`);
    const result = await handler(
      httpEvent('POST', '/media/presign-upload', {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { contentType: 'image/png', contentLength: 1024 },
      }),
    );
    expect(result.statusCode).toBe(200);
    const payload = JSON.parse(result.body ?? '') as {
      uploadUrl: string;
      objectKey: string;
      maxBytes: number;
    };
    expect(payload.objectKey.startsWith(`uploads/${userId}/`)).toBe(true);
    expect(payload.uploadUrl).toContain('/media/local-objects/');
    expect(payload.maxBytes).toBe(15 * 1024 * 1024);
  });

  it('registers and deletes a device token', async () => {
    const userId = randomUUID();
    const { accessToken } = issueLocalTokens(userId, `${userId}@example.com`);
    const deviceId = 'phone-1';

    const put = await handler(
      httpEvent('PUT', `/media/devices/${deviceId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { token: 'fcm-token', platform: 'android' },
      }),
    );
    expect(put.statusCode).toBe(200);
    expect(store.has(`USER#${userId}\0DEVICE#${deviceId}`)).toBe(true);

    const del = await handler(
      httpEvent('DELETE', `/media/devices/${deviceId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(del.statusCode).toBe(204);
    expect(store.has(`USER#${userId}\0DEVICE#${deviceId}`)).toBe(false);
  });

  it('stores and reads a local object', async () => {
    const key = `uploads/${randomUUID()}/file.bin`;
    const put = await handler(
      httpEvent('PUT', `/media/local-objects/${encodeURIComponent(key)}`, {
        headers: { 'content-type': 'application/octet-stream' },
        rawBody: 'hello',
      }),
    );
    expect(put.statusCode).toBe(204);

    const get = await handler(
      httpEvent('GET', `/media/local-objects/${encodeURIComponent(key)}`),
    );
    expect(get.statusCode).toBe(200);
    expect(get.isBase64Encoded).toBe(true);
    expect(Buffer.from(get.body ?? '', 'base64').toString('utf8')).toBe('hello');
  });
});
