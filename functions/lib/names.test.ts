/**
 * Unit tests for the local proxy path-to-port mapping.
 */

import { describe, expect, it } from 'vitest';
import { AREAS, areaPort, portForPath } from './names.js';

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
});
