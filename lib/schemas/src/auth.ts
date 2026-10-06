/**
 * Identity and session wire contracts.
 */

import { accountKindSchema } from './enums.js';
import { z } from './zod.js';

/** Body for email-and-password registration. */
export const registerBodySchema = z
  .object({
    email: z.string().email().min(3).max(320),
    password: z.string().min(8).max(256),
    displayName: z.string().min(1).max(100),
    /** Calendar date of birth (`YYYY-MM-DD`); the server derives `accountKind`. */
    birthday: z.string().date(),
  })
  .strict();

/** Body for email-and-password login. */
export const loginBodySchema = z
  .object({
    email: z.string().email().min(3).max(320),
    password: z.string().min(8).max(256),
  })
  .strict();

/**
 * Body for exchanging a refresh token for new tokens.
 *
 * The website may omit `refreshToken` and rely on the HttpOnly `ts_refresh` cookie.
 */
export const refreshBodySchema = z
  .object({
    refreshToken: z.string().min(1).optional(),
  })
  .strict();

/** Authenticated caller returned by `GET /me` and Cognito checks. */
export const authUserSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().optional(),
});

/** Profile row fields that identity and other areas share. */
export const userProfileSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().min(3).max(320),
  displayName: z.string().min(1).max(100),
  accountKind: accountKindSchema,
  birthday: z.string().date().optional(),
  /** Object key for the profile photo in the media bucket. */
  photoKey: z.string().min(1).max(512).optional(),
  /** `true` when the caller must finish birthday (and usually display name) setup. */
  needsProfileCompletion: z.boolean().optional(),
});

/** Body for setting or clearing the caller's profile photo. */
export const updateProfileBodySchema = z
  .object({
    /** `null` removes the photo. */
    photoKey: z.union([z.string().min(1).max(512), z.null()]),
  })
  .strict();

/** Body for finishing a social-sign-in profile after Hosted UI. */
export const completeProfileBodySchema = z
  .object({
    birthday: z.string().date(),
    displayName: z.string().min(1).max(100).optional(),
  })
  .strict();

/**
 * Session response for register, login, and refresh.
 *
 * `refreshToken` is present only when the client asks for a body delivery
 * (Capacitor). The website relies on the HttpOnly cookie instead.
 */
export const sessionTokensSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().min(1),
  user: userProfileSchema,
  refreshToken: z.string().min(1).optional(),
});

/** Generic `{ error }` body used by area handlers. */
export const errorBodySchema = z.object({
  error: z.string(),
});

/** Inferred type for {@link registerBodySchema}. */
export type RegisterBody = z.infer<typeof registerBodySchema>;

/** Inferred type for {@link loginBodySchema}. */
export type LoginBody = z.infer<typeof loginBodySchema>;

/** Inferred type for {@link refreshBodySchema}. */
export type RefreshBody = z.infer<typeof refreshBodySchema>;

/** Inferred type for {@link authUserSchema}. */
export type AuthUser = z.infer<typeof authUserSchema>;

/** Inferred type for {@link userProfileSchema}. */
export type UserProfile = z.infer<typeof userProfileSchema>;

/** Inferred type for {@link completeProfileBodySchema}. */
export type CompleteProfileBody = z.infer<typeof completeProfileBodySchema>;

/** Inferred type for {@link updateProfileBodySchema}. */
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

/** Inferred type for {@link sessionTokensSchema}. */
export type SessionTokens = z.infer<typeof sessionTokensSchema>;

/** Inferred type for {@link errorBodySchema}. */
export type ErrorBody = z.infer<typeof errorBodySchema>;
