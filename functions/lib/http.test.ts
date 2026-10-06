/**
 * Unit tests for shared HTTP helpers.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import {
  badRequest,
  binary,
  conflict,
  forbidden,
  handleHealth,
  headerOf,
  isHttpEvent,
  isSqsEvent,
  isWebSocketEvent,
  json,
  notFound,
  parseJsonBody,
  readCookie,
  redirect,
  unauthorized,
  withCookies,
} from './http.js';

/**
 * Builds a minimal HTTP API event for helper tests.
 *
 * @param overrides - Optional event fields.
 * @returns An HTTP API event.
 */
const httpEvent = (
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: '/teams/health',
    headers: {},
    requestContext: { http: { method: 'GET', path: '/teams/health' } },
    ...overrides,
  }) as APIGatewayProxyEventV2;

describe('http helpers', () => {
  it('builds JSON, binary, and error responses', () => {
    expect(json(200, { ok: true })).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
    });

    const bytes = Buffer.from('hello');
    expect(binary(200, 'text/plain', bytes)).toMatchObject({
      statusCode: 200,
      isBase64Encoded: true,
      body: bytes.toString('base64'),
    });

    expect(notFound().statusCode).toBe(404);
    expect(badRequest('bad_field').body).toContain('bad_field');
    expect(badRequest({ errors: [] }).body).toContain('errors');
    expect(unauthorized().statusCode).toBe(401);
    expect(unauthorized('token_expired').body).toContain('token_expired');
    expect(forbidden().statusCode).toBe(403);
    expect(conflict('email_taken').body).toContain('email_taken');
  });

  it('redirects and merges cookies', () => {
    expect(redirect('/login').statusCode).toBe(302);
    const withCookie = redirect('/home', ['a=b']);
    expect(withCookie.cookies).toEqual(['a=b']);
    expect(withCookies(json(200, {}), ['c=d']).cookies).toEqual(['c=d']);
  });

  it('narrows event shapes', () => {
    expect(isHttpEvent(httpEvent())).toBe(true);
    expect(isHttpEvent({ requestContext: { routeKey: '$connect' } })).toBe(false);
    expect(isHttpEvent(null)).toBe(false);
    expect(isHttpEvent({})).toBe(false);
    expect(isHttpEvent({ requestContext: null })).toBe(false);
    expect(isHttpEvent({ requestContext: 'bad' })).toBe(false);

    expect(
      isWebSocketEvent({ requestContext: { routeKey: '$connect' } }),
    ).toBe(true);
    expect(isWebSocketEvent(httpEvent())).toBe(false);
    expect(isWebSocketEvent(null)).toBe(false);
    expect(
      isWebSocketEvent({ requestContext: { routeKey: '$connect', http: { method: 'GET' } } }),
    ).toBe(false);

    expect(isSqsEvent({ Records: [] })).toBe(true);
    expect(isSqsEvent({ Records: 'nope' })).toBe(false);
    expect(isSqsEvent(httpEvent())).toBe(false);
  });

  it('reads cookies from the array or header', () => {
    expect(
      readCookie(
        httpEvent({
          cookies: ['session=abc', 'other=1'],
        }),
        'session',
      ),
    ).toBe('abc');

    expect(
      readCookie(
        httpEvent({
          headers: { cookie: 'session=from-header; other=2' },
        }),
        'session',
      ),
    ).toBe('from-header');

    expect(
      readCookie(
        httpEvent({
          headers: { Cookie: 'malformed; session=from-capital' },
        }),
        'session',
      ),
    ).toBe('from-capital');

    expect(
      readCookie(httpEvent({ headers: { cookie: 'malformed-only' } }), 'missing'),
    ).toBeUndefined();

    expect(
      readCookie(
        httpEvent({
          cookies: ['malformed-entry', 'session=from-list'],
        }),
        'session',
      ),
    ).toBe('from-list');
  });

  it('reads headers case-insensitively', () => {
    expect(
      headerOf(httpEvent({ headers: { Authorization: 'Bearer tok' } }), 'authorization'),
    ).toBe('Bearer tok');
    expect(headerOf(httpEvent(), 'missing')).toBeUndefined();
    expect(
      headerOf(httpEvent({ headers: { authorization: ['Bearer', 'bad'] as unknown as string } }), 'authorization'),
    ).toBeUndefined();
  });

  it('parses JSON bodies including base64 payloads', () => {
    expect(parseJsonBody(httpEvent())).toBeUndefined();
    expect(parseJsonBody(httpEvent({ body: '' }))).toBeUndefined();
    expect(parseJsonBody(httpEvent({ body: '{"a":1}' }))).toEqual({ a: 1 });
    expect(parseJsonBody(httpEvent({ body: 'not-json' }))).toBeUndefined();
    expect(
      parseJsonBody(
        httpEvent({
          isBase64Encoded: true,
          body: Buffer.from('{"b":2}').toString('base64'),
        }),
      ),
    ).toEqual({ b: 2 });
  });

  it('answers health checks for matching paths', () => {
    expect(handleHealth(httpEvent(), 'teams').statusCode).toBe(200);
    expect(handleHealth(httpEvent({ rawPath: '/health' }), 'teams').statusCode).toBe(200);
    expect(handleHealth(httpEvent({ rawPath: '/teams/health' }), 'teams').statusCode).toBe(200);
    expect(
      handleHealth(
        httpEvent({
          rawPath: '/teams',
          requestContext: { http: { method: 'POST', path: '/teams' } },
        }),
        'teams',
      ).statusCode,
    ).toBe(404);
    expect(
      handleHealth(
        {
          version: '2.0',
          requestContext: { http: { method: 'GET', path: '/health' } },
        } as APIGatewayProxyEventV2,
        'teams',
      ).statusCode,
    ).toBe(404);
  });
});
