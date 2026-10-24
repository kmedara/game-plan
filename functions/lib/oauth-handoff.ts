/**
 * One-time codes that hand a refresh token to the native app after Hosted UI.
 *
 * The system browser that completes Cognito cannot share its cookie jar with
 * React Native. The callback stores the refresh token here and redirects to
 * `gameplan://auth?code=...`. The app redeems the code once.
 */

import { randomBytes } from 'node:crypto';
import {
  OAUTH_HANDOFF_TTL_SECONDS,
  TABLE_PK,
  TABLE_SK,
  handoffPk,
  handoffSk,
  putItem,
  redeemOnce,
} from './dynamo/index.js';

/** Screen the app should open after redeeming the code. */
export type OAuthHandoffNext = 'teams' | 'complete-profile';

/** Stored handoff row under `HANDOFF#<code>` / `HANDOFF`. */
type OAuthHandoffItem = {
  PK: string;
  SK: string;
  refreshToken: string;
  next: OAuthHandoffNext;
  ttl: number;
};

/** Refresh token and destination recovered from a handoff code. */
export type RedeemedOAuthHandoff = {
  refreshToken: string;
  next: OAuthHandoffNext;
};

/**
 * Writes a random code for a refresh token the native app will redeem.
 *
 * @param refreshToken - The Cognito refresh token from the Hosted UI exchange.
 * @param next - The route the app should open.
 * @returns The opaque code.
 */
export const issueOAuthHandoff = async (
  refreshToken: string,
  next: OAuthHandoffNext,
): Promise<string> => {
  const code = randomBytes(32).toString('base64url');
  const item: OAuthHandoffItem = {
    [TABLE_PK]: handoffPk(code),
    [TABLE_SK]: handoffSk(),
    refreshToken,
    next,
    ttl: Math.floor(Date.now() / 1000) + OAUTH_HANDOFF_TTL_SECONDS,
  };
  await putItem(item);
  return code;
};

/**
 * Deletes a handoff code and returns the refresh token it held.
 *
 * A second call finds nothing, and an expired code is refused.
 *
 * @param code - The opaque id from the app redirect.
 * @returns The refresh token and destination, or `undefined` when the code cannot be used.
 */
export const redeemOAuthHandoff = async (
  code: string,
): Promise<RedeemedOAuthHandoff | undefined> => {
  if (code.length === 0) return undefined;
  const attributes = await redeemOnce(handoffPk(code), handoffSk());
  const refreshToken = attributes?.refreshToken;
  const next = attributes?.next;
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) return undefined;
  if (next !== 'teams' && next !== 'complete-profile') return undefined;
  return { refreshToken, next };
};
