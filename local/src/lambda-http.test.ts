/**
 * Unit tests for the local API Gateway event adapter.
 */

import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { toHttpEvent } from './lambda-http.js';

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
});
