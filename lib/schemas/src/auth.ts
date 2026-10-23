/**
 * Identity and session wire contracts.
 */

import { displayNameSchema } from './display-name.js';
import { accountKindSchema } from './enums.js';
import { phoneNumberSchema } from './phone.js';
import { z } from './zod.js';

/** Body for email-and-password registration. */
export const registerBodySchema = z
  .object({
    email: z.string().email().min(3).max(320),
    password: z.string().min(8).max(256),
    displayName: displayNameSchema,
    /** Calendar date of birth (`YYYY-MM-DD`); the server derives `accountKind`. */
    birthday: z.string().date(),
  })
  .strict();

/** Body for confirming an email-and-password signup with the emailed code. */
export const confirmRegistrationBodySchema = z
  .object({
    email: z.string().email().min(3).max(320),
    code: z.string().trim().min(1).max(32),
  })
  .strict();

/** Body for sending another signup confirmation code. */
export const resendConfirmationBodySchema = z
  .object({
    email: z.string().email().min(3).max(320),
  })
  .strict();

/**
 * Register response when Cognito is waiting for the emailed code.
 *
 * No access token is included.
 */
export const confirmationRequiredSchema = z.object({
  confirmationRequired: z.literal(true),
  email: z.string().email(),
});

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

export { phoneNumberSchema } from './phone.js';

/** Profile row fields that identity and other areas share. */
export const userProfileSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().min(3).max(320),
  displayName: displayNameSchema,
  accountKind: accountKindSchema,
  birthday: z.string().date().optional(),
  /** Object key for the profile photo in the media bucket. */
  photoKey: z.string().min(1).max(512).optional(),
  /** Contact phone teammates can see on a shared-team profile. */
  phoneNumber: phoneNumberSchema.optional(),
  /** `true` when the caller must finish birthday (and usually display name) setup. */
  needsProfileCompletion: z.boolean().optional(),
});

/** Body for updating the caller's photo and/or phone number. */
export const updateProfileBodySchema = z
  .object({
    /** `null` removes the photo. */
    photoKey: z.union([z.string().min(1).max(512), z.null()]).optional(),
    /** `null` removes the phone number. */
    phoneNumber: z.union([phoneNumberSchema, z.null()]).optional(),
  })
  .strict();

/** Body for finishing a social-sign-in profile after Hosted UI. */
export const completeProfileBodySchema = z
  .object({
    birthday: z.string().date(),
    displayName: displayNameSchema.optional(),
  })
  .strict();

/**
 * Session response for register, login, and refresh.
 *
 * `refreshToken` is present only when the client asks for a body delivery
 * (the Expo app). The website relies on the HttpOnly cookie instead.
 */
/** One-time WebSocket connect ticket. The value is not an access token. */
export const socketTicketSchema = z.object({
  ticket: z.string().min(1),
  expiresIn: z.number().int().min(1),
});

/** Body for redeeming a native OAuth handoff code. */
export const oauthExchangeBodySchema = z
  .object({
    code: z.string().min(1),
  })
  .strict();

/** A social sign-in the login screen can start directly. */
export const socialProviderSchema = z.enum(['apple', 'google', 'facebook']);

/** Social sign-ins configured on this deployment, in the order the login screen shows them. */
export const oauthProvidersSchema = z.object({
  providers: z.array(socialProviderSchema),
});

/** Where the app should go after a native Hosted UI sign-in. */
export const oauthNextSchema = z.enum(['teams', 'complete-profile']);

/**
 * Session tokens plus the post-login route for a native OAuth exchange.
 *
 * `refreshToken` is always present: the native app cannot read the HttpOnly cookie.
 */
export const oauthExchangeResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().min(1),
  user: userProfileSchema,
  refreshToken: z.string().min(1),
  next: oauthNextSchema,
});

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

/** Inferred type for {@link confirmRegistrationBodySchema}. */
export type ConfirmRegistrationBody = z.infer<typeof confirmRegistrationBodySchema>;

/** Inferred type for {@link resendConfirmationBodySchema}. */
export type ResendConfirmationBody = z.infer<typeof resendConfirmationBodySchema>;

/** Inferred type for {@link confirmationRequiredSchema}. */
export type ConfirmationRequired = z.infer<typeof confirmationRequiredSchema>;

/** Inferred type for {@link registerBodySchema}. */
export type RegisterBody = z.infer<typeof registerBodySchema>;

/** Inferred type for {@link loginBodySchema}. */
export type LoginBody = z.infer<typeof loginBodySchema>;

/** Inferred type for {@link refreshBodySchema}. */
export type RefreshBody = z.infer<typeof refreshBodySchema>;

/** Body for inviting a guardian by email. */
export const createGuardianInviteBodySchema = z
  .object({
    email: z.string().email().min(3).max(320),
  })
  .strict();

/** Pending or accepted guardian link. */
export const guardianLinkSchema = z
  .object({
    inviteId: z.string().min(1).optional(),
    minorId: z.string().min(1),
    adultId: z.string().min(1),
    email: z.string().min(1).optional(),
  })
  .strict();

/** Inferred type for {@link createGuardianInviteBodySchema}. */
export type CreateGuardianInviteBody = z.infer<typeof createGuardianInviteBodySchema>;

/** Inferred type for {@link guardianLinkSchema}. */
export type GuardianLinkBody = z.infer<typeof guardianLinkSchema>;

/** Inferred type for {@link authUserSchema}. */
export type AuthUser = z.infer<typeof authUserSchema>;

/** Inferred type for {@link userProfileSchema}. */
export type UserProfile = z.infer<typeof userProfileSchema>;

/** Inferred type for {@link completeProfileBodySchema}. */
export type CompleteProfileBody = z.infer<typeof completeProfileBodySchema>;

/** Inferred type for {@link updateProfileBodySchema}. */
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

/** Inferred type for {@link socketTicketSchema}. */
export type SocketTicket = z.infer<typeof socketTicketSchema>;

/** Inferred type for {@link oauthExchangeBodySchema}. */
export type OAuthExchangeBody = z.infer<typeof oauthExchangeBodySchema>;

/** Inferred type for {@link socialProviderSchema}. */
export type SocialProvider = z.infer<typeof socialProviderSchema>;

/** Inferred type for {@link oauthProvidersSchema}. */
export type OAuthProviders = z.infer<typeof oauthProvidersSchema>;

/** Inferred type for {@link oauthNextSchema}. */
export type OAuthNext = z.infer<typeof oauthNextSchema>;

/** Inferred type for {@link oauthExchangeResponseSchema}. */
export type OAuthExchangeResponse = z.infer<typeof oauthExchangeResponseSchema>;

/** Inferred type for {@link sessionTokensSchema}. */
export type SessionTokens = z.infer<typeof sessionTokensSchema>;

/** Inferred type for {@link errorBodySchema}. */
export type ErrorBody = z.infer<typeof errorBodySchema>;
