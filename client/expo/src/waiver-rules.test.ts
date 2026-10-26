/**
 * Waiver audience edits, the sign button, and the profile count.
 */

import type { MyWaiver } from '@gameplan/types';
import { signatureReady, toggleAudienceRole, waiversToSign } from './waiver-rules';

const waiver = (patch: Partial<MyWaiver>): MyWaiver => ({
  teamId: 't',
  waiverId: 'w',
  memberId: 'm',
  title: 'Release',
  body: 'Text',
  version: 1,
  status: 'missing',
  canSign: true,
  ...patch,
});

describe('waiver rules', () => {
  it('keeps at least one role in the audience, in rank order', () => {
    expect(toggleAudienceRole(['player'], 'player')).toEqual(['player']);
    expect(toggleAudienceRole(['player'], 'coach')).toEqual(['coach', 'player']);
    expect(toggleAudienceRole(['coach', 'player'], 'coach')).toEqual(['player']);
  });

  it('needs a name and the agreement box before signing', () => {
    expect(signatureReady('Ada Lovelace', false)).toBe(false);
    expect(signatureReady(' A ', true)).toBe(false);
    expect(signatureReady('Ada Lovelace', true)).toBe(true);
  });

  it('counts only waivers the caller can still sign', () => {
    expect(
      waiversToSign([
        waiver({}),
        waiver({ status: 'outdated' }),
        waiver({ status: 'signed', canSign: false }),
        waiver({ canSign: false }),
      ]),
    ).toBe(2);
  });
});
