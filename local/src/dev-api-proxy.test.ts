/**
 * Unit tests for the local `/api` prefix strip.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { stripApiPrefix } = require('../../client/expo/scripts/dev-api-proxy.js') as {
  stripApiPrefix: (rawUrl?: string) => string | undefined;
};

describe('stripApiPrefix', () => {
  it('strips the website API prefix and keeps the query string', () => {
    expect(stripApiPrefix('/api/identity/health')).toBe('/identity/health');
    expect(stripApiPrefix('/api/identity/oauth/callback?code=abc')).toBe('/identity/oauth/callback?code=abc');
    expect(stripApiPrefix('/api')).toBe('/');
    expect(stripApiPrefix('/api?x=1')).toBe('/?x=1');
  });

  it('leaves website routes alone', () => {
    expect(stripApiPrefix('/schedule')).toBeUndefined();
    expect(stripApiPrefix('/teams')).toBeUndefined();
    expect(stripApiPrefix(undefined)).toBeUndefined();
  });
});
