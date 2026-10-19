/**
 * Server-side plan checks.
 *
 * Each team has one `TEAM#<teamId>` / `PLAN` row. Billing writes it from Stripe
 * events; an organization's subscription is copied onto each of its teams'
 * rows, so a check is always one read. What a tier unlocks is decided by
 * `entitlementsFor` in `@gameplan/rules`, the same function the app uses.
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { entitlementsFor, FREE_PLAN, type Entitlements } from '@gameplan/rules';
import type { TeamPlan } from '@gameplan/types';
import { getItem } from './dynamo/access.js';
import { planSk, teamPk } from './dynamo/keys.js';
import { json } from './http.js';
import { asStep, type Step } from './pipeline.js';

/** Stored plan row: the wire plan plus bookkeeping for ordering Stripe events. */
export type PlanItem = TeamPlan & {
  teamId: string;
  /** Unix seconds of the Stripe event last applied, so an older event cannot overwrite a newer one. */
  stripeEventCreated?: number;
  updatedAt?: string;
};

/**
 * A team's plan, or free when it has none.
 *
 * @param teamId - The team.
 * @returns The wire plan.
 */
export const loadTeamPlan = async (teamId: string): Promise<TeamPlan> => {
  const item = await getItem<PlanItem>(teamPk(teamId), planSk());
  if (item === undefined) return FREE_PLAN;
  return {
    tier: item.tier,
    status: item.status,
    ...(item.interval !== undefined ? { interval: item.interval } : {}),
    ...(item.currentPeriodEnd !== undefined ? { currentPeriodEnd: item.currentPeriodEnd } : {}),
    ...(item.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: item.cancelAtPeriodEnd } : {}),
    ...(item.orgId !== undefined ? { orgId: item.orgId } : {}),
  };
};

/**
 * What a team's plan unlocks right now.
 *
 * @param teamId - The team.
 * @param now - The clock.
 * @returns Limits and flags.
 */
export const loadTeamEntitlements = async (teamId: string, now: Date = new Date()): Promise<Entitlements> =>
  entitlementsFor({ teamPlan: await loadTeamPlan(teamId) }, now);

/** Plan features a route can require outright. Count and size limits are checked where items are added. */
export type PlanFeature = 'video' | 'waivers' | 'orgFeatures' | 'ai';

/**
 * Whether entitlements include a feature.
 *
 * @param entitlements - The team's entitlements.
 * @param feature - The feature a route needs.
 * @returns `true` when the plan includes it.
 */
const includes = (entitlements: Entitlements, feature: PlanFeature): boolean => {
  switch (feature) {
    case 'video':
      return entitlements.video;
    case 'waivers':
      return entitlements.waivers;
    case 'orgFeatures':
      return entitlements.orgFeatures;
    case 'ai':
      return entitlements.aiMonthly > 0;
  }
};

/**
 * Ensures the team's plan includes a feature and attaches `entitlements`.
 *
 * List after `requireMembership`, so a non-member learns nothing about the plan.
 *
 * @param feature - The feature the route needs.
 * @returns A step that throws `plan_required` when the plan lacks it.
 */
export const requireEntitlement = (
  feature: PlanFeature,
): Step<{ teamId: string }, { entitlements: Entitlements }> =>
  asStep<{ teamId: string }, { entitlements: Entitlements }>(async (ctx, next) => {
    const entitlements = await loadTeamEntitlements(ctx.teamId);
    if (!includes(entitlements, feature)) throw new Error('plan_required');
    return next({ ...ctx, entitlements });
  });

/**
 * Maps plan errors to `402 Payment Required`. Areas call it from their own mapper.
 *
 * @param error - The thrown value.
 * @returns A response for `plan_required` and `plan_limit_reached`, otherwise `undefined`.
 */
export const mapPlanError = (error: unknown): APIGatewayProxyStructuredResultV2 | undefined => {
  if (!(error instanceof Error)) return undefined;
  if (error.message === 'plan_required' || error.message === 'plan_limit_reached') {
    return json(402, { error: error.message });
  }
  return undefined;
};
