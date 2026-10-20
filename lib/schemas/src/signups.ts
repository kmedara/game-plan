/**
 * Volunteer sign-ups on one occurrence: snacks, scorekeeper, drivers.
 */

import { displayNameSchema } from './display-name.js';
import { z } from './zod.js';

/** Most slots one occurrence may have. */
export const MAX_SIGNUP_SLOTS = 12;

/** Most people one slot may hold. */
export const MAX_SIGNUP_CAPACITY = 20;

const occurrence = {
  eventId: z.string().min(1),
  occurrenceStartsAt: z.string().datetime(),
};

/** Query for `GET /schedule/teams/:teamId/signups`. */
export const signupsQuerySchema = z.object(occurrence).strict();

/** One slot as staff define it. A slot without `slotId` is new. */
export const signupSlotInputSchema = z
  .object({
    slotId: z.string().min(1).max(40).optional(),
    label: z.string().trim().min(1).max(60),
    capacity: z.number().int().min(1).max(MAX_SIGNUP_CAPACITY),
  })
  .strict();

/** Body for `PUT /schedule/teams/:teamId/signups`: the full slot list. Claims on kept slots stay. */
export const putSignupsBodySchema = z
  .object({
    ...occurrence,
    slots: z.array(signupSlotInputSchema).max(MAX_SIGNUP_SLOTS),
  })
  .strict();

/**
 * Body for `PUT /schedule/teams/:teamId/signups/claim`. Claims the slot, or
 * leaves it when already claimed. `forUserId` lets a guardian sign up a child
 * and staff remove someone.
 */
export const claimSignupBodySchema = z
  .object({
    ...occurrence,
    slotId: z.string().min(1).max(40),
    forUserId: z.string().min(1).optional(),
  })
  .strict();

/** One person on a slot. */
export const signupClaimSchema = z
  .object({
    userId: z.string().min(1),
    displayName: displayNameSchema.optional(),
    /** Who signed them up, when it was someone else (a guardian). */
    claimedBy: z.string().min(1),
  })
  .strict();

/** One slot with who is on it. */
export const signupSlotSchema = z
  .object({
    slotId: z.string().min(1),
    label: z.string().min(1),
    capacity: z.number().int().min(1),
    claims: z.array(signupClaimSchema),
  })
  .strict();

/** Sign-ups from `GET` or `PUT /schedule/teams/:teamId/signups`. */
export const signupsResponseSchema = z
  .object({
    ...occurrence,
    slots: z.array(signupSlotSchema),
  })
  .strict();

/** Inferred type for {@link signupsQuerySchema}. */
export type SignupsQuery = z.infer<typeof signupsQuerySchema>;

/** Inferred type for {@link putSignupsBodySchema}. */
export type PutSignupsBody = z.infer<typeof putSignupsBodySchema>;

/** Inferred type for {@link claimSignupBodySchema}. */
export type ClaimSignupBody = z.infer<typeof claimSignupBodySchema>;

/** Inferred type for {@link signupSlotSchema}. */
export type SignupSlot = z.infer<typeof signupSlotSchema>;

/** Inferred type for {@link signupsResponseSchema}. */
export type SignupsResponse = z.infer<typeof signupsResponseSchema>;
