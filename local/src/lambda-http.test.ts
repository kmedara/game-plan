/**
 * Unit tests for the local API Gateway event adapter.
 */

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { toHttpEvent, writeResult } from './lambda-http.js';

/**
 * Builds a minimal async-iterable request with an empty body.
 *
 * @param url - The request URL path, including query string.
 * @returns A stand-in IncomingMessage for {@link toHttpEvent}.
 */
const fakeRequest = (url: string): IncomingMessage => {
  const req = new EventEmitter() as IncomingMessage & EventEmitter;
  req.url = url;
  req.method = 'GET';
  req.headers = {};
  (req as IncomingMessage & AsyncIterable<Buffer>)[Symbol.asyncIterator] = async function* () {
    // Empty body for GET directory searches.
  };
  return req;
};

describe('toHttpEvent', () => {
  it('parses query string parameters for directory-style searches', async () => {
    const event = await toHttpEvent(fakeRequest('/teams/directory?q=Peoria'), 3002);
    expect(event.rawPath).toBe('/teams/directory');
    expect(event.rawQueryString).toBe('q=Peoria');
    expect(event.queryStringParameters).toEqual({ q: 'Peoria' });
  });

  it('omits queryStringParameters when the URL has no query', async () => {
    const event = await toHttpEvent(fakeRequest('/teams/directory'), 3002);
    expect(event.queryStringParameters).toBeUndefined();
  });

  it('base64-encodes image uploads and writes image bytes back', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff]);
    const req = new EventEmitter() as IncomingMessage & EventEmitter;
    req.url = '/media/local-objects/uploads%2Fuser%2Fphoto';
    req.method = 'PUT';
    req.headers = { 'content-type': 'image/png' };
    (req as IncomingMessage & AsyncIterable<Buffer>)[Symbol.asyncIterator] = async function* () {
      yield png;
    };

    const event = await toHttpEvent(req, 3105);
    expect(event.isBase64Encoded).toBe(true);
    expect(Buffer.from(event.body ?? '', 'base64')).toEqual(png);

    const written: Buffer[] = [];
    const res = {
      writeHead: () => undefined,
      end: (body?: unknown) => {
        if (Buffer.isBuffer(body)) written.push(body);
      },
    } as unknown as ServerResponse;
    writeResult(res, {
      statusCode: 200,
      isBase64Encoded: true,
      body: png.toString('base64'),
      headers: { 'content-type': 'image/png' },
    });
    expect(written).toEqual([png]);
  });
});
