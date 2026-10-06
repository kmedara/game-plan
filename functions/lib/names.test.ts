/**
 * Unit tests for the local proxy path-to-port mapping.
 */

import { describe, expect, it } from 'vitest';
import { AREAS, areaPort, portForPath, PROXY_PORT } from './names.js';

describe('portForPath', () => {
  it('routes each area prefix to its own port', () => {
    for (const area of AREAS) {
      expect(portForPath(`/${area}/health`)).toBe(areaPort(area));
    }
  });

  it('ignores a query string', () => {
    expect(portForPath('/socket?token=abc')).toBe(areaPort('socket'));
  });

  it('returns undefined for an unknown prefix', () => {
    expect(portForPath('/missing')).toBeUndefined();
  });

  it('matches an area root path without a trailing segment', () => {
    expect(portForPath('/teams')).toBe(areaPort('teams'));
  });

  it('treats an empty path as the root for area matching', () => {
    expect(portForPath('')).toBeUndefined();
    expect(portForPath('?only=query')).toBeUndefined();
  });
});

describe('areaPort and constants', () => {
  it('assigns sequential ports from the configured first area port', () => {
    expect(PROXY_PORT).toBeTypeOf('number');
    expect(areaPort('identity')).toBe(areaPort(AREAS[0]));
    expect(areaPort('fanout')).toBeGreaterThan(areaPort('identity'));
  });
});
