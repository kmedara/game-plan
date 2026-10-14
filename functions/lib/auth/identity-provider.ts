/**
 * Shared identity provider contract for Cognito and local laptop auth.
 */

import type { AccountKind, LoginBody, UserProfile } from '@gameplan/types';
import { accountKindForProfile } from '@gameplan/rules';

/**
 * Cognito signup that is waiting for the emailed confirmation code.
 *
 * No session is issued until the code is confirmed.
 */
export type ConfirmationRequired = {
  status: 'confirmation_required';
  /** Cognito `sub` for the unconfirmed account. */
  userId: string;
  /** Normalized email the code was sent to. */
  email: string;
};

/** Session from a provider that does not use an email code, or a completed login. */
export type AuthenticatedRegistration = IdentityTokens & {
  status?: 'authenticated';
};

/** Result of {@link IdentityProvider.register}. */
export type RegisterResult = AuthenticatedRegistration | ConfirmationRequired;

/** Result of register, login, or refresh. */
export type IdentityTokens = {
  /** Cognito or local access JWT. */
  accessToken: string;
  /** Cognito or local refresh token. */
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  /** User id (`sub`) that owns the tokens. */
  userId: string;
  /** Email claim when the provider has one. */
  email: string;
};

/** Input for email-and-password registration. */
export type RegisterInput = {
  email: string;
  password: string;
  displayName: string;
  accountKind: AccountKind;
};

/**
 * Creates accounts and issues tokens. Implementations talk to Cognito in the
 * cloud, or to DynamoDB plus local JWTs on the laptop.
 */
export type IdentityProvider = {
  /**
   * Registers a new account.
   *
   * Cognito returns {@link ConfirmationRequired} and does not issue tokens.
   * The local provider returns a session because it has no mail channel.
   *
   * @param input - Email, password, display name, and account kind.
   * @returns A session, or a pending email confirmation.
   */
  register: (input: RegisterInput) => Promise<RegisterResult>;

  /**
   * Confirms a Cognito signup with the code sent to the email address.
   *
   * @param email - The account email.
   * @param code - The confirmation code from the email.
   */
  confirmRegistration: (email: string, code: string) => Promise<void>;

  /**
   * Sends another Cognito confirmation code.
   *
   * Unknown addresses are ignored so the response does not reveal whether an
   * account exists.
   *
   * @param email - The account email.
   */
  resendConfirmation: (email: string) => Promise<void>;

  /**
   * Authenticates an existing account.
   *
   * @param input - Email and password.
   * @returns Issued tokens and the user id.
   */
  login: (input: LoginBody) => Promise<IdentityTokens>;

  /**
   * Exchanges a refresh token for a new access token (and rotated refresh).
   *
   * @param refreshToken - The refresh token from a cookie or request body.
   * @returns Issued tokens and the user id.
   */
  refresh: (refreshToken: string) => Promise<IdentityTokens>;

  /**
   * Revokes a refresh token when the provider supports it.
   *
   * @param refreshToken - The refresh token to revoke, when present.
   */
  logout: (refreshToken?: string) => Promise<void>;
};

/** DynamoDB shape of the user profile row under `USER#id` / `PROFILE`. */
export type UserProfileItem = {
  PK: string;
  SK: string;
  userId: string;
  email: string;
  displayName: string;
  accountKind: AccountKind;
  /** Calendar date of birth (`YYYY-MM-DD`) when collected. */
  birthday?: string;
  /** Media object key for the profile photo, when the user has set one. */
  photoKey?: string;
  /** Contact phone teammates can see on a shared-team profile. */
  phoneNumber?: string;
  createdAt: string;
  /** Present only for the local identity provider. */
  passwordHash?: string;
};

/**
 * Maps a profile item to the public wire shape.
 *
 * @param item - The DynamoDB profile row.
 * @returns The profile fields returned by identity routes.
 */
export const toUserProfile = (item: UserProfileItem): UserProfile => ({
  userId: item.userId,
  email: item.email,
  displayName: item.displayName,
  accountKind: accountKindForProfile(item.birthday, item.accountKind),
  ...(item.birthday !== undefined ? { birthday: item.birthday } : {}),
  ...(item.photoKey !== undefined ? { photoKey: item.photoKey } : {}),
  ...(item.phoneNumber !== undefined ? { phoneNumber: item.phoneNumber } : {}),
  needsProfileCompletion: item.birthday === undefined,
});
