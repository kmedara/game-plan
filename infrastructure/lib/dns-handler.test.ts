/**
 * Unit tests for which certificate the DNS export keeps returning.
 */

import { describe, expect, it } from 'vitest';
import { exportedCertificateDomain } from './dns-handler';

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
