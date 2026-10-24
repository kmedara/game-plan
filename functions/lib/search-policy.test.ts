/**
 * Unit tests for the global user-search policy filter and name matching.
 */

import { describe, expect, it } from 'vitest';
import { matchesPersonName, matchesUserSearchPolicy, V1_USER_SEARCH_POLICY } from '@gameplan/rules';

describe('matchesPersonName', () => {
  const ada = { displayName: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace' };

  it('matches the start of a first or last name, ignoring case and spacing', () => {
    expect(matchesPersonName('ada', ada)).toBe(true);
    expect(matchesPersonName('LOVE', ada)).toBe(true);
    expect(matchesPersonName('  ada   lo ', ada)).toBe(true);
  });

  it('does not match the middle of a word or a name in the wrong order', () => {
    expect(matchesPersonName('ace', ada)).toBe(false);
    expect(matchesPersonName('lovelace ada', ada)).toBe(false);
  });

  it('uses the first and last name when the display name differs', () => {
    expect(matchesPersonName('lovelace', { displayName: 'Countess', firstName: 'Ada', lastName: 'Lovelace' })).toBe(
      true,
    );
  });

  it('matches everyone on an empty query', () => {
    expect(matchesPersonName('  ', {})).toBe(true);
  });
});

describe('user search policy', () => {
  it('returns adults only under the v1 policy', () => {
    expect(matchesUserSearchPolicy('adult', V1_USER_SEARCH_POLICY)).toBe(true);
    expect(matchesUserSearchPolicy('minor', V1_USER_SEARCH_POLICY)).toBe(false);
  });

  it('can widen to minors when a later safety pass changes the filter', () => {
    expect(matchesUserSearchPolicy('minor', { adultsOnly: false })).toBe(true);
  });
});
