/**
 * Ensures the AUTH_DISABLED seed profile exists and issues local session tokens.
 */

import {
  issueLocalTokens,
  getProfile,
  seedUserId,
  toUserProfile,
} from '../../../lib/auth/index.js';
import type { UserProfile } from '@gameplan/types';

/**
 * Loads the env-configured seed profile and returns session tokens for it.
 *
 * The profile must already exist (for example from the local demo team seed).
 *
 * @returns Access/refresh tokens and the public seed profile.
 */
export const issueSeedSession = async (): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserProfile;
}> => {
  const userId = seedUserId();
  const profile = await getProfile(userId);
  if (profile === undefined) throw new Error('profile_not_found');
  const tokens = issueLocalTokens(userId, profile.email);
  return {
    ...tokens,
    user: toUserProfile(profile),
  };
};
