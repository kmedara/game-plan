/**
 * Unit tests for the staging sign-up allowlist.
 */

import { describe, expect, it } from 'vitest';
import { emailAllowed } from './pre-signup.js';

const sample = 'Ada@Example.com, bob@example.com\ncara@example.com';

describe('emailAllowed', () => {
  it('allows an address on the list', () => {
    expect(emailAllowed('bob@example.com', sample)).toBe(true);
  });

  it('matches a different casing', () => {
    expect(emailAllowed('ada@example.com', sample)).toBe(true);
  });

  it('rejects an address that is not listed', () => {
    expect(emailAllowed('eve@example.com', sample)).toBe(false);
  });

  it('rejects every address when the list is blank', () => {
    expect(emailAllowed('ada@example.com', '')).toBe(false);
    expect(emailAllowed('ada@example.com', '  \n')).toBe(false);
    expect(emailAllowed(undefined, sample)).toBe(false);
  });
});
