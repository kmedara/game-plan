/**
 * Unit tests for Content-Security-Policy violation reports.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cspViolations, handler, MAX_REPORT_BYTES } from './csp-report.js';

const event = (body: string | undefined, method = 'POST', rawPath = '/csp-report'): APIGatewayProxyEventV2 =>
  ({ rawPath, body, isBase64Encoded: false, requestContext: { http: { method } }, headers: {} }) as unknown as APIGatewayProxyEventV2;

describe('cspViolations', () => {
  it('reads a report-uri report and drops queries and the sample', () => {
    const [entry, ...rest] = cspViolations({
      'csp-report': {
        'document-uri': 'https://staging.example.com/auth?code=secret',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example/x.js?t=1',
        'source-file': 'https://staging.example.com/_expo/app.js',
        'line-number': 12,
        disposition: 'report',
        'script-sample': 'a child name',
      },
    });
    expect(rest).toEqual([]);
    expect(entry).toEqual({
      disposition: 'report',
      directive: 'script-src-elem',
      blocked: 'https://evil.example/x.js',
      page: 'https://staging.example.com/auth',
      source: 'https://staging.example.com/_expo/app.js:12',
    });
    expect(JSON.stringify(entry)).not.toContain('child');
  });

  it('reads a Reporting API batch and skips other report types', () => {
    const entries = cspViolations([
      { type: 'deprecation', body: { id: 'x' } },
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://staging.example.com/chats/1#top',
          effectiveDirective: 'require-trusted-types-for',
          blockedURL: 'trusted-types-sink',
          disposition: 'report',
          sample: 'HTMLScriptElement src|https://maps.googleapis.com',
        },
      },
    ]);
    expect(entries).toEqual([
      {
        disposition: 'report',
        directive: 'require-trusted-types-for',
        blocked: 'trusted-types-sink',
        page: 'https://staging.example.com/chats/1',
      },
    ]);
  });

  it('ignores bodies that are not reports', () => {
    expect(cspViolations(undefined)).toEqual([]);
    expect(cspViolations({ hello: 'world' })).toEqual([]);
    expect(cspViolations([1, null, 'x'])).toEqual([]);
  });

  it('logs at most ten violations from one batch', () => {
    const one = { type: 'csp-violation', body: { documentURL: 'https://a.example/', effectiveDirective: 'img-src' } };
    expect(cspViolations(Array.from({ length: 50 }, () => one))).toHaveLength(10);
  });
});

describe('handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs each violation and answers 204', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await handler(
      event(JSON.stringify({ 'csp-report': { 'document-uri': 'https://a.example/', 'effective-directive': 'script-src', 'blocked-uri': 'inline' } })),
    );
    expect(result.statusCode).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ msg: 'csp_violation', directive: 'script-src', blocked: 'inline' });
  });

  it('answers 204 without logging for junk, empty, or oversized bodies', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const body of [undefined, '', 'not json', 'x'.repeat(MAX_REPORT_BYTES + 1)]) {
      expect((await handler(event(body))).statusCode).toBe(204);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers 404 off the report path', async () => {
    expect((await handler(event('{}', 'GET'))).statusCode).toBe(404);
    expect((await handler(event('{}', 'POST', '/identity/me'))).statusCode).toBe(404);
  });
});
