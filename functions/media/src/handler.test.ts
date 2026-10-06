/**
 * Media Lambda coverage for presign and device token routes.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

  it('presigns download, accepts base64 local puts, and covers route edges', async () => {
    process.env.LOCAL_JWT_SECRET = 'media-handler-test-secret';
    const userId = randomUUID();
    const { accessToken } = issueLocalTokens(userId, `${userId}@example.com`);
    const key = `uploads/${userId}/photo.png`;

    const download = await handler(
      httpEvent('GET', '/media/presign-download', {
        headers: { authorization: `Bearer ${accessToken}` },
        query: { objectKey: key },
      }),
    );
    expect(download.statusCode).toBe(200);
    expect(JSON.parse(download.body ?? '').downloadUrl).toContain('/media/local-objects/');

    const putB64 = await handler(
      httpEvent('PUT', `/media/local-objects/${encodeURIComponent(key)}`, {
        headers: { 'content-type': 'image/png' },
        rawBody: Buffer.from('png').toString('base64'),
        isBase64Encoded: true,
      }),
    );
    expect(putB64.statusCode).toBe(204);

    const missing = await handler(
      httpEvent('GET', `/media/local-objects/${encodeURIComponent('uploads/missing/x.bin')}`),
    );
    expect(missing.statusCode).toBe(404);

    expect((await handler(httpEvent('GET', '/media'))).statusCode).toBe(404);
    expect((await handler(httpEvent('GET', '/health'))).statusCode).toBe(200);
    expect(
      (
        await handler(
          httpEvent('GET', 'presign-download', { query: { objectKey: key } }),
        )
      ).statusCode,
    ).toBe(401);
  });

  it('maps media errors for invalid keys and oversized local puts', async () => {
    const badKey = await handler(httpEvent('GET', '/media/local-objects/%2e%2e%2fescape'));
    expect([400, 404]).toContain(badKey.statusCode);

    const huge = Buffer.alloc(16 * 1024 * 1024).toString('base64');
    const oversized = await handler(
      httpEvent('PUT', `/media/local-objects/${encodeURIComponent('uploads/u/big.bin')}`, {
        headers: { 'content-type': 'application/octet-stream' },
        rawBody: huge,
        isBase64Encoded: true,
      }),
    );
    expect(oversized.statusCode).toBe(400);
  });

  it('maps media errors, rejects invalid keys, and handles non-local mode', async () => {
    const { mapMediaError } = await import('./routes/errors.js');
    expect(mapMediaError('nope')).toBeUndefined();
    expect(mapMediaError(new Error('unauthorized'))?.statusCode).toBe(401);
    expect(mapMediaError(new Error('forbidden'))?.statusCode).toBe(403);
    expect(mapMediaError(new Error('invalid_object_key'))?.statusCode).toBe(400);
    expect(mapMediaError(new Error('media_bucket_not_configured'))?.statusCode).toBe(503);

    const userId = randomUUID();
    const { accessToken } = issueLocalTokens(userId, `${userId}@example.com`);
    const badDownload = await handler(
      httpEvent('GET', '/media/presign-download', {
        headers: { authorization: `Bearer ${accessToken}` },
        query: { objectKey: '../escape.png' },
      }),
    );
    expect(badDownload.statusCode).toBe(400);

    const emptyDevice = await handler(
      httpEvent('PUT', `/media/devices/${'d'.repeat(129)}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { token: 'x', platform: 'ios' },
      }),
    );
    expect(emptyDevice.statusCode).toBe(400);

    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.MEDIA_BUCKET;
    const missingBucket = await handler(
      httpEvent('POST', '/media/presign-upload', {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { contentType: 'image/png', contentLength: 128 },
      }),
    );
    expect(missingBucket.statusCode).toBe(503);
    process.env.DYNAMODB_ENDPOINT = 'http://127.0.0.1:8000';
    process.env.MEDIA_BUCKET = 'gameplan-media-local';

    const { listDevicesForUser } = await import('./device-store.js');
    await listDevicesForUser(userId);
  });

  it('rejects path traversal when MEDIA_LOCAL_DIR is set', async () => {
    const dir = join(process.cwd(), '.media-test-' + randomUUID());
    process.env.MEDIA_LOCAL_DIR = dir;
    try {
      const nested = join(dir, 'nested');
      mkdirSync(nested, { recursive: true });
      const key = 'nested/segment/../../outside.bin';
      const put = await handler(
        httpEvent('PUT', `/media/local-objects/${encodeURIComponent(key)}`, {
          headers: { 'content-type': 'application/octet-stream' },
          rawBody: 'x',
        }),
      );
      expect(put.statusCode).toBe(400);
    } finally {
      delete process.env.MEDIA_LOCAL_DIR;
    }
  });

  it('normalizes slash-only paths and missing rawPath', async () => {
    expect((await handler(httpEvent('GET', '///'))).statusCode).toBe(404);
    expect(
      (
        await handler({
          version: '2.0',
          requestContext: { http: { method: 'GET', path: '/media/presign-download' } },
        } as APIGatewayProxyEventV2)
      ).statusCode,
    ).toBe(404);
  });

  it('covers bare media paths and health routing', async () => {
    expect((await handler(httpEvent('DELETE', '/media/devices/phone-1'))).statusCode).toBe(401);
    expect(
      (await handler(httpEvent('DELETE', '/media/devices/phone-1', { headers: { authorization: 'Bearer bad' } })))
        .statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect((await handler(httpEvent('GET', '/media/presign-download'))).statusCode).toBe(400);
    expect((await handler(httpEvent('DELETE', 'devices/phone-1'))).statusCode).toBe(401);
    expect((await handler(httpEvent('GET', 'local-objects/x'))).statusCode).toBe(404);
    expect((await handler(httpEvent('GET', '/presign-download'))).statusCode).toBe(400);
    expect((await handler(httpEvent('GET', '/health'))).statusCode).toBe(200);
    expect((await handler(httpEvent('GET', '/media/local-objects/x', {}))).statusCode).toBe(404);
    const dlUser = randomUUID();
    const { accessToken } = issueLocalTokens(dlUser, `${dlUser}@example.com`);
    expect(
      (
        await handler(
          httpEvent('GET', 'presign-download', {
            headers: { authorization: `Bearer ${accessToken}` },
            query: { objectKey: `uploads/${dlUser}/x.png` },
          }),
        )
      ).statusCode,
    ).toBe(200);
  });
});
