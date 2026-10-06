/**
 * Local auth bypass (`AUTH_DISABLED`) and the env-configured seed user id.
 *
 * When `AUTH_DISABLED=true`, set `AUTH_SEED_USER_ID` to an existing profile id
 * (for example a demo team admin). Email and display name come from that row.
 */

/**
 * Returns whether Cognito Hosted UI is bypassed for local development.
 *
 * @returns `true` when `AUTH_DISABLED` is the string `true`.
 */
export const isAuthDisabled = (): boolean => process.env.AUTH_DISABLED === 'true';

/**
 * Reads `AUTH_SEED_USER_ID` (required when auth bypass is on).
 *
 * @returns The seed user id.
 * @throws When `AUTH_SEED_USER_ID` is missing or blank.
 */
export const seedUserId = (): string => {
  const userId = process.env.AUTH_SEED_USER_ID?.trim();
  if (userId !== undefined && userId.length > 0) return userId;
  throw new Error('seed_user_id_required');
};
