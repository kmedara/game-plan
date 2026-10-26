/**
 * Album storage reads like the plans screen, clips read as m:ss, and every failure has a sentence.
 */

import { albumFailureKey, formatClipLength, formatStorage } from './album';

const GIB = 1024 * 1024 * 1024;

describe('formatStorage', () => {
  it('states GB from one up, and MB below', () => {
    expect(formatStorage(2 * GIB, 'en')).toBe('2 GB');
    expect(formatStorage(1.25 * GIB, 'en')).toBe('1.3 GB');
    expect(formatStorage(50 * GIB, 'en')).toBe('50 GB');
    expect(formatStorage(340 * 1024 * 1024, 'en')).toBe('340 MB');
    expect(formatStorage(1, 'en')).toBe('1 MB');
    expect(formatStorage(0, 'en')).toBe('0 MB');
  });
});

describe('formatClipLength', () => {
  it('pads seconds', () => {
    expect(formatClipLength(125)).toBe('2:05');
    expect(formatClipLength(599.6)).toBe('10:00');
    expect(formatClipLength(4)).toBe('0:04');
  });
});

describe('albumFailureKey', () => {
  it('names the plan limits', () => {
    expect(albumFailureKey('plan_required')).toBe('errors.album.planRequired');
    expect(albumFailureKey('plan_limit_reached')).toBe('errors.album.storageFull');
    expect(albumFailureKey('video_too_long')).toBe('errors.album.videoTooLong');
  });
});
