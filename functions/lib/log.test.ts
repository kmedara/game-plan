/**
 * Area and route labels on structured error logs.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorMessage, functionArea, httpRoute, logError } from './log.js';

describe('functionArea', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers the stamped area, then the Lambda name without its prefix', () => {
    vi.stubEnv('AREA', ' teams ');
    expect(functionArea()).toBe('teams');
    vi.stubEnv('AREA', '');
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'gameplan-chat');
    expect(functionArea()).toBe('chat');
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'other-fn');
    expect(functionArea()).toBe('other-fn');
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', '');
    expect(functionArea()).toBe('unknown');
  });
});

describe('httpRoute', () => {
  it('joins the method and path, or says unknown', () => {
    expect(httpRoute({ rawPath: '/teams', requestContext: { http: { method: 'GET' } } })).toBe('GET /teams');
    expect(httpRoute({ rawPath: '/teams' })).toBe('/teams');
    expect(httpRoute({})).toBe('unknown');
  });
});

describe('logError', () => {
  it('writes one JSON line with the message of any thrown value', () => {
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logError({ area: 'chat', route: 'GET /chat', msg: errorMessage(new Error('boom')), error: { code: 1 } });
    expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual({
      area: 'chat',
      route: 'GET /chat',
      msg: 'boom',
      error: '{"code":1}',
    });
    expect(errorMessage('plain')).toBe('plain');
    write.mockRestore();
  });
});
