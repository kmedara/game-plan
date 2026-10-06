/**
 * DynamoDB-backed identity provider for local development without Cognito.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getItem, putItem } from '../dynamo/access.js';
import { TABLE_PK, TABLE_SK, profileSk, userPk } from '../dynamo/keys.js';
import type {
  IdentityProvider,
  IdentityTokens,
  LoginInput,
  RegisterInput,
  UserProfileItem,
} from './identity-provider.js';
import { issueLocalTokens, verifyLocalJwt } from './local-jwt.js';
import { findProfileByEmail } from './profile.js';

/** Scrypt parameters for local password hashes. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

/**
 * Hashes a password with a random salt for local storage.
 *
 * @param password - The plaintext password.
 * @returns A `scrypt$salt$hash` string.
 */
const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

/**
 * Verifies a plaintext password against a stored local hash.
 *
 * @param password - The plaintext password.
 * @param stored - The `scrypt$salt$hash` value from the profile row.
 * @returns `true` when the password matches.
 */
const verifyPassword = (password: string, stored: string): boolean => {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
};

/**
 * Builds a stable local user id from the email so re-registers stay deterministic
 * only after a conflict check — each new account still gets a fresh UUID-like id.
 *
 * @returns A random hex user id.
 */
const newUserId = (): string => randomBytes(16).toString('hex');

/**
 * Creates the local identity provider.
 *
 * @returns An {@link IdentityProvider} that stores passwords on profile rows.
 */
export const createLocalIdentityProvider = (): IdentityProvider => ({
  async register(input: RegisterInput): Promise<IdentityTokens> {
    const email = input.email.trim().toLowerCase();
    const existing = await findProfileByEmail(email);
    if (existing !== undefined) throw new Error('email_taken');

    const userId = newUserId();
    const createdAt = new Date().toISOString();
    const item: UserProfileItem = {
      [TABLE_PK]: userPk(userId),
      [TABLE_SK]: profileSk(),
      userId,
      email,
      displayName: input.displayName.trim(),
      accountKind: input.accountKind,
      createdAt,
      passwordHash: hashPassword(input.password),
    };
    await putItem(item);

    const tokens = issueLocalTokens(userId, email);
    return { ...tokens, userId, email };
  },

  async login(input: LoginInput): Promise<IdentityTokens> {
    const email = input.email.trim().toLowerCase();
    const profile = await findProfileByEmail(email);
    if (profile?.passwordHash === undefined) throw new Error('invalid_credentials');
    if (!verifyPassword(input.password, profile.passwordHash)) {
      throw new Error('invalid_credentials');
    }

    const tokens = issueLocalTokens(profile.userId, profile.email);
    return { ...tokens, userId: profile.userId, email: profile.email };
  },

  async refresh(refreshToken: string): Promise<IdentityTokens> {
    const claims = verifyLocalJwt(refreshToken);
    if (claims.token_use !== 'refresh') throw new Error('invalid_token');

    const profile = await getItem<UserProfileItem>(userPk(claims.sub), profileSk());
    if (profile === undefined) throw new Error('profile_not_found');

    const tokens = issueLocalTokens(profile.userId, profile.email);
    return { ...tokens, userId: profile.userId, email: profile.email };
  },

  async logout(_refreshToken?: string): Promise<void> {
    // Local JWTs are short-lived; clearing the cookie / client store is enough.
  },
});
