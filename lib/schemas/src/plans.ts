/**
 * Paid plan wire contracts: tiers, subscription status, and billing routes.
 *
 * What each tier unlocks lives in `@gameplan/rules` (`entitlementsFor`), so the
 * API and the app read one table.
 */

import { z } from './zod.js';

/** Plan tiers, cheapest first. */
export const PLAN_TIERS = ['free', 'premium', 'organization'] as const;

/** Schema for {@link PLAN_TIERS}. */
export const planTierSchema = z.enum(PLAN_TIERS);

/** Inferred type for {@link planTierSchema}. */
export type PlanTier = z.infer<typeof planTierSchema>;

/** Subscription states, as Stripe reports them, reduced to what gating needs. */
export const PLAN_STATUSES = ['active', 'trialing', 'past_due', 'canceled'] as const;

/** Schema for {@link PLAN_STATUSES}. */
export const planStatusSchema = z.enum(PLAN_STATUSES);

/** Inferred type for {@link planStatusSchema}. */
export type PlanStatus = z.infer<typeof planStatusSchema>;

/** How often a paid plan renews. */
export const BILLING_INTERVALS = ['month', 'year'] as const;

/** Schema for {@link BILLING_INTERVALS}. */
export const billingIntervalSchema = z.enum(BILLING_INTERVALS);

/** Inferred type for {@link billingIntervalSchema}. */
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

/** A team's plan as members see it. A team with no subscription is `free` and `active`. */
export const teamPlanSchema = z
  .object({
    tier: planTierSchema,
    status: planStatusSchema,
    interval: billingIntervalSchema.optional(),
    /** End of the paid period (ISO). A `past_due` plan keeps its features for a grace period after this. */
    currentPeriodEnd: z.string().min(1).optional(),
    /** The plan ends at `currentPeriodEnd` instead of renewing. */
    cancelAtPeriodEnd: z.boolean().optional(),
    /** Set when the plan comes from an organization's subscription. */
    orgId: z.string().min(1).optional(),
  })
  .strict();

/** Inferred type for {@link teamPlanSchema}. */
export type TeamPlan = z.infer<typeof teamPlanSchema>;

/** Where Stripe should send the buyer back: the native app or the website. */
export const BILLING_RETURN_TARGETS = ['app', 'web'] as const;

/** Body for `POST /billing/teams/:teamId/checkout`. */
export const teamCheckoutBodySchema = z
  .object({
    interval: billingIntervalSchema,
    returnTo: z.enum(BILLING_RETURN_TARGETS).default('app'),
  })
  .strict();

/** Inferred type for {@link teamCheckoutBodySchema}. */
export type TeamCheckoutBody = z.infer<typeof teamCheckoutBodySchema>;

/** Body for `POST /billing/teams/:teamId/portal`. */
export const billingPortalBodySchema = z
  .object({
    returnTo: z.enum(BILLING_RETURN_TARGETS).default('app'),
  })
  .strict();

/** Inferred type for {@link billingPortalBodySchema}. */
export type BillingPortalBody = z.infer<typeof billingPortalBodySchema>;

/** How a hosted Stripe billing page finished. */
export const BILLING_RETURN_RESULTS = ['subscribed', 'cancel', 'portal'] as const;

/** Query for `GET /billing/return`, the fixed URL Stripe redirects to. */
export const billingReturnQuerySchema = z.object({
  to: z.enum(BILLING_RETURN_TARGETS),
  result: z.enum(BILLING_RETURN_RESULTS),
  teamId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u)
    .optional(),
});

/** Inferred type for {@link billingReturnQuerySchema}. */
export type BillingReturnQuery = z.infer<typeof billingReturnQuerySchema>;

/** `GET /billing/teams/:teamId`. */
export const teamBillingSchema = z
  .object({
    teamId: z.string().min(1),
    plan: teamPlanSchema,
    /** Whether the team has a Stripe customer, so the billing portal can open. */
    hasBillingAccount: z.boolean(),
  })
  .strict();

/** Inferred type for {@link teamBillingSchema}. */
export type TeamBilling = z.infer<typeof teamBillingSchema>;
