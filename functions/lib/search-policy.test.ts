/**
 * Unit tests for the global user-search policy filter.
 */

import { describe, expect, it } from 'vitest';
import { matchesUserSearchPolicy, V1_USER_SEARCH_POLICY } from './search-policy.js';

describe('user search policy', () => {
  it('returns adults only under the v1 policy', () => {
    expect(matchesUserSearchPolicy('adult', V1_USER_SEARCH_POLICY)).toBe(true);
    expect(matchesUserSearchPolicy('minor', V1_USER_SEARCH_POLICY)).toBe(false);
  });

  it('can widen to minors when a later safety pass changes the filter', () => {
    expect(matchesUserSearchPolicy('minor', { adultsOnly: false })).toBe(true);
  });
});
