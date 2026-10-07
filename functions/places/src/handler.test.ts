/**
 * Places Lambda coverage with mocked Google Places / Maps HTTP calls.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

process.env.LOCAL_JWT_SECRET = 'places-handler-test-secret';
process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';

const { handler } = await import('./handler.js');

/**
 * Builds a minimal HTTP API event for places routes.
 *
 * @param method - The HTTP method.
 * @param path - The request path, including `/places`.
 * @param options - Optional headers and query string.
 * @returns An HTTP API event.
 */
const httpEvent = (
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.headers ?? {},
    queryStringParameters: options.query,
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

/**
 * Issues a bearer authorization header for a test user.
 *
 * @returns Authorization header map.
 */
const authHeader = (): Record<string, string> => {
  const { accessToken } = issueLocalTokens('user-1', 'user-1@example.com');
  return { authorization: `Bearer ${accessToken}` };
};

/**
 * Builds a fetch Response-like object for the stubbed global fetch.
 *
 * @param body - JSON body, string, or ArrayBuffer.
 * @param init - Status and headers.
 * @returns A Response.
 */
const mockResponse = (
  body: unknown,
  init: { status?: number; contentType?: string } = {},
): Response => {
  const status = init.status ?? 200;
  const contentType = init.contentType ?? 'application/json';
  if (body instanceof ArrayBuffer || Buffer.isBuffer(body)) {
    const bytes = body instanceof ArrayBuffer ? body : body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    );
    return new Response(bytes, {
      status,
      headers: { 'content-type': contentType },
    });
  }
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
};

describe('places handler', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';
  });

  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';
  });

  it('normalizes slash-only paths and missing rawPath', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ suggestions: [] }));
    expect((await handler(httpEvent('GET', '///'))).statusCode).toBe(404);
    expect(
      (
        await handler({
          version: '2.0',
          requestContext: { http: { method: 'GET', path: '/places/autocomplete' } },
          queryStringParameters: { q: 'x' },
          headers: authHeader(),
        } as APIGatewayProxyEventV2)
      ).statusCode,
    ).toBe(404);
  });

  it('returns health for /places/health and /health', async () => {
    for (const path of ['/places/health', '/health']) {
      const result = await handler(httpEvent('GET', path));
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body ?? '')).toEqual({ ok: true, service: 'places' });
    }
  });

  it('returns 404 for unknown routes and bare /places', async () => {
    expect((await handler(httpEvent('GET', '/places'))).statusCode).toBe(404);
    expect((await handler(httpEvent('GET', '/places/unknown'))).statusCode).toBe(404);
    expect((await handler(httpEvent('POST', '/places/autocomplete'))).statusCode).toBe(404);
  });

  it('autocompletes places for an authenticated user', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        suggestions: [
          {
            placePrediction: {
              placeId: 'p1',
              structuredFormat: {
                mainText: { text: 'Riverside Field' },
                secondaryText: { text: 'Austin, TX' },
              },
            },
          },
          {
            placePrediction: {
              placeId: '',
              text: { text: 'skip-me' },
            },
          },
          {
            placePrediction: {
              placeId: 'p2',
              text: { text: 'Fallback Name' },
            },
          },
          {},
        ],
      }),
    );

    const result = await handler(
      httpEvent('GET', '/places/autocomplete', {
        headers: authHeader(),
        query: { q: 'river' },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '')).toEqual({
      suggestions: [
        {
          id: 'p1',
          primaryText: 'Riverside Field',
          secondaryText: 'Austin, TX',
        },
        { id: 'p2', primaryText: 'Fallback Name' },
      ],
    });
  });

  it('resolves a place id with combined label branches', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        displayName: { text: 'Riverside Field' },
        formattedAddress: '100 Main St, Austin, TX',
        location: { latitude: 30.1, longitude: -97.7 },
      }),
    );
    const combined = await handler(
      httpEvent('GET', '/places/resolve', {
        headers: authHeader(),
        query: { id: 'place-1' },
      }),
    );
    expect(combined.statusCode).toBe(200);
    expect(JSON.parse(combined.body ?? '')).toMatchObject({
      label: 'Riverside Field, 100 Main St, Austin, TX',
      latitude: 30.1,
      longitude: -97.7,
    });

    fetchMock.mockResolvedValueOnce(
      mockResponse({
        displayName: { text: 'City Hall' },
        formattedAddress: 'City Hall, 1 City Hall Square, Boston, MA',
        location: { latitude: 1, longitude: 2 },
      }),
    );
    const addressContainsName = await handler(
      httpEvent('GET', '/places/resolve', {
        headers: authHeader(),
        query: { id: 'place-2' },
      }),
    );
    expect(JSON.parse(addressContainsName.body ?? '').label).toBe(
      'City Hall, 1 City Hall Square, Boston, MA',
    );

    fetchMock.mockResolvedValueOnce(
      mockResponse({
        displayName: { text: 'Park' },
        formattedAddress: '',
        location: { latitude: 1, longitude: 2 },
      }),
    );
    const nameOnly = await handler(
      httpEvent('GET', '/places/resolve', {
        headers: authHeader(),
        query: { id: 'place-2b' },
      }),
    );
    expect(JSON.parse(nameOnly.body ?? '').label).toBe('Park');

    fetchMock.mockResolvedValueOnce(
      mockResponse({
        displayName: { text: '' },
        formattedAddress: 'Only Address',
        location: { latitude: 1, longitude: 2 },
      }),
    );
    const addressOnly = await handler(
      httpEvent('GET', '/places/resolve', {
        headers: authHeader(),
        query: { id: 'place-3' },
      }),
    );
    expect(JSON.parse(addressOnly.body ?? '').label).toBe('Only Address');

    fetchMock.mockResolvedValueOnce(
      mockResponse({
        location: { latitude: 1, longitude: 2 },
      }),
    );
    const fallback = await handler(
      httpEvent('GET', '/places/resolve', {
        headers: authHeader(),
        query: { id: 'place-4' },
      }),
    );
    expect(JSON.parse(fallback.body ?? '').label).toBe('Selected place');
  });

  it('maps resolve not-found and upstream errors', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 404 }));
    const missing = await handler(
      httpEvent('GET', '/places/resolve', {
        headers: authHeader(),
        query: { id: 'missing' },
      }),
    );
    expect(missing.statusCode).toBe(404);

    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 500 }));
    const upstream = await handler(
      httpEvent('GET', '/places/resolve', {
        headers: authHeader(),
        query: { id: 'bad' },
      }),
    );
    expect(upstream.statusCode).toBe(502);

    fetchMock.mockResolvedValueOnce(
      mockResponse({
        displayName: { text: 'No coords' },
        formattedAddress: 'Somewhere',
      }),
    );
    const noCoords = await handler(
      httpEvent('GET', '/places/resolve', {
        headers: authHeader(),
        query: { id: 'nocoords' },
      }),
    );
    expect(noCoords.statusCode).toBe(404);
  });

  it('reverse-geocodes pins including ZERO_RESULTS and empty address', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 'OK',
        results: [{ formatted_address: '123 Main St' }],
      }),
    );
    const ok = await handler(
      httpEvent('GET', '/places/reverse', {
        headers: authHeader(),
        query: { latitude: '30.2672', longitude: '-97.7431' },
      }),
    );
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body ?? '').label).toBe('123 Main St');

    fetchMock.mockResolvedValueOnce(mockResponse({ status: 'ZERO_RESULTS', results: [] }));
    const zero = await handler(
      httpEvent('GET', '/places/reverse', {
        headers: authHeader(),
        query: { latitude: '1', longitude: '2' },
      }),
    );
    expect(JSON.parse(zero.body ?? '').label).toBe('1.00000, 2.00000');

    fetchMock.mockResolvedValueOnce(
      mockResponse({ status: 'OK', results: [{ formatted_address: '   ' }] }),
    );
    const emptyAddr = await handler(
      httpEvent('GET', '/places/reverse', {
        headers: authHeader(),
        query: { latitude: '3', longitude: '4' },
      }),
    );
    expect(JSON.parse(emptyAddr.body ?? '').label).toBe('3.00000, 4.00000');

    fetchMock.mockResolvedValueOnce(mockResponse({ status: 'REQUEST_DENIED' }));
    const denied = await handler(
      httpEvent('GET', '/places/reverse', {
        headers: authHeader(),
        query: { latitude: '1', longitude: '2' },
      }),
    );
    expect(denied.statusCode).toBe(502);

    fetchMock.mockResolvedValueOnce(mockResponse('fail', { status: 500, contentType: 'text/plain' }));
    const upstream = await handler(
      httpEvent('GET', '/places/reverse', {
        headers: authHeader(),
        query: { latitude: '1', longitude: '2' },
      }),
    );
    expect(upstream.statusCode).toBe(502);
  });

  it('returns a static map PNG preview', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    fetchMock.mockResolvedValueOnce(
      mockResponse(png, { contentType: 'image/png' }),
    );
    const result = await handler(
      httpEvent('GET', '/places/map', {
        headers: authHeader(),
        query: { latitude: '30', longitude: '-97' },
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(result.isBase64Encoded).toBe(true);
    expect(result.headers?.['content-type']).toBe('image/png');
    expect(result.body).toBe(png.toString('base64'));

    fetchMock.mockResolvedValueOnce(mockResponse('x', { status: 500, contentType: 'text/plain' }));
    expect(
      (
        await handler(
          httpEvent('GET', '/places/map', {
            headers: authHeader(),
            query: { latitude: '30', longitude: '-97' },
          }),
        )
      ).statusCode,
    ).toBe(502);

    fetchMock.mockResolvedValueOnce(
      mockResponse(Buffer.from('not-image'), { contentType: 'application/octet-stream' }),
    );
    expect(
      (
        await handler(
          httpEvent('GET', '/places/map', {
            headers: authHeader(),
            query: { latitude: '30', longitude: '-97' },
          }),
        )
      ).statusCode,
    ).toBe(502);
  });

  it('returns 503 when the API key is missing and 401 without auth', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const unconfigured = await handler(
      httpEvent('GET', '/places/autocomplete', {
        headers: authHeader(),
        query: { q: 'x' },
      }),
    );
    expect(unconfigured.statusCode).toBe(503);

    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';
    const unauthorized = await handler(
      httpEvent('GET', '/places/autocomplete', { query: { q: 'x' } }),
    );
    expect(unauthorized.statusCode).toBe(401);
  });

  it('maps autocomplete upstream failures and empty suggestions', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({}, { status: 500 }));
    const upstream = await handler(
      httpEvent('GET', '/places/autocomplete', {
        headers: authHeader(),
        query: { q: 'x' },
      }),
    );
    expect(upstream.statusCode).toBe(502);

    fetchMock.mockResolvedValueOnce(mockResponse({}));
    const empty = await handler(
      httpEvent('GET', '/places/autocomplete', {
        headers: authHeader(),
        query: { q: 'x' },
      }),
    );
    expect(JSON.parse(empty.body ?? '')).toEqual({ suggestions: [] });
  });

  it('normalizes route paths without the /places prefix', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ suggestions: [] }));
    const result = await handler(
      httpEvent('GET', '/autocomplete', {
        headers: authHeader(),
        query: { q: 'park' },
      }),
    );
    expect(result.statusCode).toBe(200);

    fetchMock.mockResolvedValueOnce(mockResponse({ suggestions: [] }));
    const bare = await handler(
      httpEvent('GET', 'autocomplete', {
        headers: authHeader(),
        query: { q: 'park' },
      }),
    );
    expect(bare.statusCode).toBe(200);
  });
});
