/**
 * Unit tests for which certificate the DNS export keeps returning.
 */

import { describe, expect, it } from 'vitest';
import { exportedCertificateDomain, staleCnames } from './dns-handler';

describe('stale CNAMEs', () => {
  it('deletes names the new deploy dropped and keeps names it rewrites', () => {
    expect(
      staleCnames(
        [
          { Name: 'a._domainkey.staging.example.com', Value: 'a.dkim.amazonses.com' },
          { Name: 'b._domainkey.staging.example.com', Value: 'b.dkim.amazonses.com' },
        ],
        [{ Name: 'a._domainkey.staging.example.com', Value: 'a2.dkim.amazonses.com' }],
      ),
    ).toEqual([{ Name: 'b._domainkey.staging.example.com', Value: 'b.dkim.amazonses.com' }]);
  });

  it('has nothing to delete on the first deploy', () => {
    expect(staleCnames(undefined, [{ Name: 'a', Value: 'b' }])).toEqual([]);
  });
});

describe('exported certificate domain', () => {
  it('keeps the retained hostname after the website hostname has already changed', () => {
    expect(exportedCertificateDomain('staging.example.com', 'app.staging.example.com', 'staging.example.com')).toBe(
      'app.staging.example.com',
    );
  });

  it('uses the previous hostname when no retained hostname is set', () => {
    expect(exportedCertificateDomain('staging.example.com', undefined, 'app.staging.example.com')).toBe(
      'app.staging.example.com',
    );
  });

  it('returns the current certificate when nothing older is pinned', () => {
    expect(exportedCertificateDomain('staging.example.com', 'staging.example.com', 'staging.example.com')).toBeUndefined();
  });
});
