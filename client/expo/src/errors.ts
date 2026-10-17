/**
 * Maps thrown errors to translated sentences.
 *
 * The API client throws `Error(code)` with the API's error code. Screens pass
 * the codes whose wording depends on the screen; everything else uses
 * {@link SHARED_MESSAGES}, and an unknown code shows the screen's fallback
 * instead of the raw code.
 */

/** Sentences that read the same wherever the code appears. */
const SHARED_MESSAGES: Readonly<Record<string, string>> = {
  minor_cannot_be_team_admin: 'errors.roles.minorCannotBeTeamAdmin',
  minor_cannot_hold_manage_permissions: 'errors.roles.minorCannotManagePermissions',
  role_outranks_caller: 'errors.roles.outranksCaller',
  forbidden: 'errors.common.forbidden',
  invalid_interval: 'errors.event.invalidRepeat',
  invalid_by_week_day: 'errors.event.invalidRepeat',
  invalid_count: 'errors.event.invalidRepeat',
  invalid_until: 'errors.event.invalidRepeat',
  invalid_recurrence: 'errors.event.invalidRepeat',
  invalid_ends_at: 'errors.event.endsBeforeStart',
};

/**
 * The error code carried by a thrown value.
 *
 * @param err - Anything a promise rejected with.
 * @param fallback - Returned when there is no code.
 * @returns The code.
 */
export const errorCode = (err: unknown, fallback = ''): string =>
  err instanceof Error && err.message.length > 0 ? err.message : fallback;

/**
 * The thrown value from a failed TanStack Query, or `undefined` when none.
 *
 * Successful queries keep `error: null`. Treating that as a failure made every
 * screen show its load-failed sentence after data arrived.
 *
 * @param error - `useQuery().error`, which is `null` after a successful fetch.
 * @returns The `Error` when a fetch failed, otherwise `undefined`.
 */
export const queryError = (error: unknown): Error | undefined =>
  error instanceof Error ? error : undefined;

/**
 * Translation key for a thrown value.
 *
 * @param err - Anything a promise rejected with.
 * @param fallbackKey - Key used when the code has no sentence.
 * @param overrides - Screen-specific keys by code. These win over the shared map.
 * @returns A catalog key.
 */
export const errorMessageKey = (
  err: unknown,
  fallbackKey: string,
  overrides: Readonly<Record<string, string>> = {},
): string => {
  const code = errorCode(err);
  return overrides[code] ?? SHARED_MESSAGES[code] ?? fallbackKey;
};
