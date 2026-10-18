/**
 * Upload keys stay under the uploader's own prefix.
 */

import { describe, expect, it } from 'vitest';
import { isOwnedUploadKey, newUploadKey, uploadPrefix } from './upload-keys.js';

describe('upload keys', () => {
  it('makes new keys under the uploader prefix', () => {
    const key = newUploadKey('u1');
    expect(key.startsWith(uploadPrefix('u1'))).toBe(true);
    expect(isOwnedUploadKey('u1', key)).toBe(true);
  });

  it('rejects other users, the bare prefix, and path tricks', () => {
    expect(isOwnedUploadKey('u1', 'uploads/u2/file')).toBe(false);
    expect(isOwnedUploadKey('u1', 'uploads/u1/')).toBe(false);
    expect(isOwnedUploadKey('u1', 'uploads/u1/../u2/file')).toBe(false);
    expect(isOwnedUploadKey('u1', String.raw`uploads/u1/a\b`)).toBe(false);
  });
});
