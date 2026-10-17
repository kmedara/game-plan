/**
 * Error codes map to translation keys, never to raw codes.
 */

import { errorCode, errorMessageKey } from './errors';

describe('errorMessageKey', () => {
  it('prefers a screen override, then the shared map, then the fallback', () => {
    const forbidden = new Error('forbidden');
    expect(errorMessageKey(forbidden, 'fallback', { forbidden: 'screen.forbidden' })).toBe('screen.forbidden');
    expect(errorMessageKey(forbidden, 'fallback')).toBe('errors.common.forbidden');
    expect(errorMessageKey(new Error('http_502'), 'fallback')).toBe('fallback');
  });

  it('falls back for values that carry no code', () => {
    expect(errorMessageKey('oops', 'fallback')).toBe('fallback');
    expect(errorMessageKey(new Error(''), 'fallback')).toBe('fallback');
    expect(errorCode(undefined, 'none')).toBe('none');
  });
});
