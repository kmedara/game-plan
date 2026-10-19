/**
 * Team dues wire contracts: Stripe Connect accounts, charges, and per-member dues.
 *
 * Amounts are integer minor units (cents). A charge is what staff ask for; a due
 * is one member's share of it.
 */

import { dueStatusSchema } from './enums.js';
import { z } from './zod.js';

/** Currencies a team can charge in. Each has a Stripe minimum below {@link MIN_CHARGE_CENTS}. */
export const CHARGE_CURRENCIES = ['usd', 'cad', 'eur', 'gbp', 'aud'] as const;

/** Schema for {@link CHARGE_CURRENCIES}. */
export const chargeCurrencySchema = z.enum(CHARGE_CURRENCIES);

/** Inferred type for {@link chargeCurrencySchema}. */
export type ChargeCurrency = z.infer<typeof chargeCurrencySchema>;

/** Smallest amount a charge may ask for, in minor units. */
export const MIN_CHARGE_CENTS = 100;

/** Largest amount a charge may ask for, in minor units. */
export const MAX_CHARGE_CENTS = 1_000_000;

/** Most members one charge may cover. */
export const MAX_CHARGE_MEMBERS = 200;

/** Calendar date `YYYY-MM-DD`. */
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'invalid_date');

/** Body for `POST /payments/teams/:teamId/charges`. */
export const createChargeBodySchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000).optional(),
    amountCents: z.number().int().min(MIN_CHARGE_CENTS).max(MAX_CHARGE_CENTS),
    currency: chargeCurrencySchema.default('usd'),
    dueDate: dateOnlySchema,
    memberIds: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_CHARGE_MEMBERS)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate_member' }),
  })
  .strict();

/** Statuses staff may set by hand. Stripe sets the rest. */
export const MANUAL_DUE_STATUSES = ['unpaid', 'paid_offline', 'waived'] as const;

/** Body for `PATCH /payments/teams/:teamId/charges/:chargeId/dues/:memberId`. */
export const updateDueBodySchema = z
  .object({
    status: z.enum(MANUAL_DUE_STATUSES),
  })
  .strict();

/** Where Stripe should send the payer back: the native app or the website. */
export const PAYMENT_RETURN_TARGETS = ['app', 'web'] as const;

/** Body for the onboarding-link and checkout routes. */
export const paymentReturnBodySchema = z
  .object({
    returnTo: z.enum(PAYMENT_RETURN_TARGETS).default('app'),
  })
  .strict();

/** How a hosted Stripe page finished. */
export const PAYMENT_RETURN_RESULTS = ['success', 'cancel', 'onboarded', 'refresh'] as const;

/** Query for `GET /payments/return`, the fixed URL Stripe redirects to. */
export const paymentReturnQuerySchema = z.object({
  to: z.enum(PAYMENT_RETURN_TARGETS),
  result: z.enum(PAYMENT_RETURN_RESULTS),
  teamId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u)
    .optional(),
});

/** `GET /payments/teams/:teamId/account`. */
export const paymentAccountSchema = z
  .object({
    teamId: z.string().min(1),
    connected: z.boolean(),
    chargesEnabled: z.boolean(),
    payoutsEnabled: z.boolean(),
    detailsSubmitted: z.boolean(),
  })
  .strict();

/** A hosted Stripe page to open in the browser (onboarding or checkout). */
export const paymentRedirectSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

/** Paid and outstanding totals for one charge. */
export const chargeTotalsSchema = z
  .object({
    members: z.number().int().min(0),
    settled: z.number().int().min(0),
    outstanding: z.number().int().min(0),
    collectedCents: z.number().int().min(0),
  })
  .strict();

/** One charge with its totals. */
export const chargeSchema = z
  .object({
    teamId: z.string().min(1),
    chargeId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    amountCents: z.number().int(),
    currency: chargeCurrencySchema,
    dueDate: dateOnlySchema,
    createdBy: z.string().min(1),
    createdAt: z.string().min(1),
    totals: chargeTotalsSchema,
  })
  .strict();

/** `GET /payments/teams/:teamId/charges`. */
export const chargeListSchema = z
  .object({
    teamId: z.string().min(1),
    charges: z.array(chargeSchema),
  })
  .strict();

/** One member's share of a charge. */
export const dueSchema = z
  .object({
    teamId: z.string().min(1),
    chargeId: z.string().min(1),
    memberId: z.string().min(1),
    memberName: z.string().optional(),
    status: dueStatusSchema,
    amountCents: z.number().int(),
    paidBy: z.string().min(1).optional(),
    paidAt: z.string().min(1).optional(),
    updatedAt: z.string().min(1),
  })
  .strict();

/** `GET /payments/teams/:teamId/charges/:chargeId`. */
export const chargeDetailSchema = z
  .object({
    charge: chargeSchema,
    dues: z.array(dueSchema),
  })
  .strict();

/** A due the caller owes, for themselves or for a child. */
export const myDueSchema = z
  .object({
    teamId: z.string().min(1),
    teamName: z.string().optional(),
    chargeId: z.string().min(1),
    memberId: z.string().min(1),
    memberName: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    amountCents: z.number().int(),
    currency: chargeCurrencySchema,
    dueDate: dateOnlySchema,
    status: dueStatusSchema,
    paidAt: z.string().min(1).optional(),
    /** Whether the caller may open a checkout for it (a minor's dues are paid by a guardian). */
    canPay: z.boolean(),
  })
  .strict();

/** `GET /payments/me/dues`. */
export const myDuesSchema = z
  .object({
    dues: z.array(myDueSchema),
  })
  .strict();

/** Inferred type for {@link createChargeBodySchema}. */
export type CreateChargeBody = z.infer<typeof createChargeBodySchema>;

/** Inferred type for {@link updateDueBodySchema}. */
export type UpdateDueBody = z.infer<typeof updateDueBodySchema>;

/** Inferred type for {@link paymentReturnBodySchema}. */
export type PaymentReturnBody = z.infer<typeof paymentReturnBodySchema>;

/** Inferred type for {@link paymentReturnQuerySchema}. */
export type PaymentReturnQuery = z.infer<typeof paymentReturnQuerySchema>;

/** Inferred type for {@link paymentAccountSchema}. */
export type PaymentAccount = z.infer<typeof paymentAccountSchema>;

/** Inferred type for {@link paymentRedirectSchema}. */
export type PaymentRedirect = z.infer<typeof paymentRedirectSchema>;

/** Inferred type for {@link chargeTotalsSchema}. */
export type ChargeTotals = z.infer<typeof chargeTotalsSchema>;

/** Inferred type for {@link chargeSchema}. */
export type Charge = z.infer<typeof chargeSchema>;

/** Inferred type for {@link chargeListSchema}. */
export type ChargeList = z.infer<typeof chargeListSchema>;

/** Inferred type for {@link dueSchema}. */
export type Due = z.infer<typeof dueSchema>;

/** Inferred type for {@link chargeDetailSchema}. */
export type ChargeDetail = z.infer<typeof chargeDetailSchema>;

/** Inferred type for {@link myDueSchema}. */
export type MyDue = z.infer<typeof myDueSchema>;

/** Inferred type for {@link myDuesSchema}. */
export type MyDues = z.infer<typeof myDuesSchema>;
