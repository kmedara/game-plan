/**
 * Unit tests for which certificate the DNS export keeps returning.
 */

import { describe, expect, it } from 'vitest';
import { exportedCertificateDomain, recordsOf, staleRecords, txtRecordValue } from './dns-handler';

describe('stale records', () => {
  it('deletes names the new deploy dropped and keeps names it rewrites', () => {
    const previous = recordsOf({
      Cnames: [
        { Name: 'a._domainkey.staging.example.com', Value: 'a.dkim.amazonses.com' },
        { Name: 'b._domainkey.staging.example.com', Value: 'b.dkim.amazonses.com' },
      ],
    });
    const current = recordsOf({ Cnames: [{ Name: 'a._domainkey.staging.example.com', Value: 'a2.dkim.amazonses.com' }] });
    expect(staleRecords(previous, current)).toEqual([
      { Name: 'b._domainkey.staging.example.com', Type: 'CNAME', Values: ['b.dkim.amazonses.com'] },
    ]);
  });

  it('tells record types apart on the same name', () => {
    const mx = { Name: 'example.com', Type: 'MX' as const, Values: ['1 smtp.google.com'] };
    const txt = { Name: 'example.com.', Type: 'TXT' as const, Values: ['v=spf1 include:_spf.google.com ~all'] };
    expect(staleRecords([mx, txt], [{ ...txt, Name: 'Example.com' }])).toEqual([mx]);
  });

  it('has nothing to delete on the first deploy', () => {
    expect(staleRecords(undefined, recordsOf({ Cnames: [{ Name: 'a', Value: 'b' }] }))).toEqual([]);
  });
});

describe('TXT values', () => {
  it('quotes a value and escapes quotes and backslashes', () => {
    expect(txtRecordValue('v=DMARC1; p=none')).toBe('"v=DMARC1; p=none"');
    expect(txtRecordValue('say "hi" \\o/')).toBe('"say \\"hi\\" \\\\o/"');
  });

  it('splits a long value into 255-character strings', () => {
    const value = txtRecordValue('x'.repeat(300));
    expect(value).toBe(`"${'x'.repeat(255)}" "${'x'.repeat(45)}"`);
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
