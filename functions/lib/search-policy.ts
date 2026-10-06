/**
 * Global user-search policy.
 *
 * Until the safety pass, search returns adults only. The filter is a parameter
 * so that pass can change who appears without a new chat model.
 */

import type { AccountKind } from '@gameplan/types';

/** Policy applied by the adult (or later, wider) user search. */
export type UserSearchPolicy = {
  /** When true, only adults appear in global user search. */
  adultsOnly: boolean;
};

/** v1 search policy: exact-email lookup returns adults only. */
export const V1_USER_SEARCH_POLICY: UserSearchPolicy = {
  adultsOnly: true,
};

/**
 * Returns whether a profile may appear in search under the given policy.
 *
 * @param accountKind - The candidate's account kind.
 * @param policy - The search policy. Defaults to {@link V1_USER_SEARCH_POLICY}.
 * @returns `true` when the candidate should be returned to the caller.
 */
export const matchesUserSearchPolicy = (
  accountKind: AccountKind,
  policy: UserSearchPolicy = V1_USER_SEARCH_POLICY,
): boolean => !policy.adultsOnly || accountKind === 'adult';
