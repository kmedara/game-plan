/**
 * Organization facts other areas need: which organization a team is in, who
 * administers it, and keeping member teams' plans in step with the
 * organization's subscription.
 *
 * An organization's plan lives at `ORG#<orgId>` / `PLAN` and is copied onto
 * each member team's `PLAN` row with `orgId` set, so a team's entitlement
 * check stays one read. A team's own subscription never overwrites a copied
 * plan (`applySubscription` skips rows with `orgId`).
 *
 * A team keeps paying for its own plan while its organization is unpaid. Once
 * the organization's plan is active, the team's own subscription is cancelled
 * with the unused time refunded, and the organization's plan takes over.
 */

import { effectivePlanTier } from '@gameplan/rules';
import type { TeamPlan } from '@gameplan/types';
import {
  ORG_TEAM_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  deleteItem,
  getItem,
  orgAdminSk,
  orgPk,
  planSk,
  putItem,
  queryBySkPrefix,
  teamOrgSk,
  teamPk,
} from './dynamo/index.js';
import type { PlanItem } from './entitlements.js';
import { cancelTeamSubscription } from './team-subscription.js';

/** `TEAM#<teamId>` / `ORG`. */
type TeamOrgItem = { teamId: string; orgId: string };

/** `ORG#<orgId>` / `TEAM#<teamId>`. */
export type OrgTeamItem = { orgId: string; teamId: string; pending: boolean; addedAt: string };

/** Stored organization plan, with the same ordering fields as a team plan. */
export type OrgPlanItem = TeamPlan & { orgId: string; stripeEventCreated?: number; updatedAt?: string; version?: number };

/**
 * The organization a team belongs to.
 *
 * @param teamId - The team.
 * @returns The organization id, or `undefined` for an independent team.
 */
export const orgIdOfTeam = async (teamId: string): Promise<string | undefined> =>
  (await getItem<TeamOrgItem>(teamPk(teamId), teamOrgSk()))?.orgId;

/**
 * Whether a user administers an organization.
 *
 * @param orgId - The organization.
 * @param userId - The user.
 * @returns `true` for an admin (the owner is always one).
 */
export const isOrgAdmin = async (orgId: string, userId: string): Promise<boolean> =>
  (await getItem(orgPk(orgId), orgAdminSk(userId))) !== undefined;

/**
 * Whether a user administers the organization a team belongs to.
 *
 * @param teamId - The team.
 * @param userId - The user.
 * @returns `true` when the team is in an organization the user administers.
 */
export const administersTeamOrg = async (teamId: string, userId: string): Promise<boolean> => {
  const orgId = await orgIdOfTeam(teamId);
  return orgId !== undefined && (await isOrgAdmin(orgId, userId));
};

/**
 * Teams that have joined an organization (not ones still invited).
 *
 * @param orgId - The organization.
 * @returns Team ids.
 */
export const memberTeamIds = async (orgId: string): Promise<string[]> =>
  (await queryBySkPrefix<OrgTeamItem>(orgPk(orgId), ORG_TEAM_SK_PREFIX))
    .filter((row) => !row.pending)
    .map((row) => row.teamId);

/**
 * An organization's plan, or `undefined` before it subscribes.
 *
 * @param orgId - The organization.
 * @returns The stored plan row.
 */
export const loadOrgPlan = async (orgId: string): Promise<OrgPlanItem | undefined> =>
  getItem<OrgPlanItem>(orgPk(orgId), planSk());

/**
 * The wire plan for an organization: its subscription, or free.
 *
 * @param orgId - The organization.
 * @returns The plan.
 */
export const orgPlan = async (orgId: string): Promise<TeamPlan> => {
  const item = await loadOrgPlan(orgId);
  if (item === undefined) return { tier: 'free', status: 'active' };
  return {
    tier: item.tier,
    status: item.status,
    ...(item.interval !== undefined ? { interval: item.interval } : {}),
    ...(item.currentPeriodEnd !== undefined ? { currentPeriodEnd: item.currentPeriodEnd } : {}),
    ...(item.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: item.cancelAtPeriodEnd } : {}),
  };
};

/**
 * Whether an organization's plan is giving its teams paid features right now.
 *
 * @param plan - The stored organization plan.
 * @returns `true` while it grants the organization tier.
 */
export const orgPlanIsPaid = (plan: OrgPlanItem | undefined): plan is OrgPlanItem =>
  plan !== undefined && effectivePlanTier(plan) !== 'free';

/**
 * Cancels a team's own subscription, refunding unused time, and records it as
 * cancelled right away so a second check cannot cancel again before Stripe's
 * event arrives.
 *
 * @param teamId - The team.
 * @returns What was refunded, in minor units; `0` when it was not paying.
 */
export const cancelOwnTeamPlan = async (teamId: string): Promise<number> => {
  const current = await getItem<PlanItem>(teamPk(teamId), planSk());
  if (current === undefined || current.orgId !== undefined || current.tier === 'free' || current.status === 'canceled') {
    return 0;
  }
  const { refundedCents } = await cancelTeamSubscription(teamId);
  await putItem({
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: planSk(),
    ...current,
    status: 'canceled',
    updatedAt: new Date().toISOString(),
  });
  return refundedCents;
};

/**
 * Copies an organization's plan onto one member team.
 *
 * While the organization is unpaid, only an earlier copy is cleared; a team
 * paying for its own plan keeps it. Once the organization is paid, the team's
 * own subscription is cancelled with a refund before the copy is written.
 *
 * @param orgId - The organization.
 * @param teamId - The member team.
 * @param plan - The organization's plan, when already loaded.
 * @returns What was refunded from the team's own plan, in minor units.
 */
export const copyOrgPlanToTeam = async (orgId: string, teamId: string, plan?: OrgPlanItem): Promise<number> => {
  const source = plan ?? (await loadOrgPlan(orgId));
  if (!orgPlanIsPaid(source)) {
    await clearOrgPlanFromTeam(orgId, teamId);
    return 0;
  }
  const refundedCents = await cancelOwnTeamPlan(teamId);
  const item: PlanItem = {
    teamId,
    tier: source.tier,
    status: source.status,
    ...(source.interval !== undefined ? { interval: source.interval } : {}),
    ...(source.currentPeriodEnd !== undefined ? { currentPeriodEnd: source.currentPeriodEnd } : {}),
    ...(source.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: source.cancelAtPeriodEnd } : {}),
    orgId,
    updatedAt: new Date().toISOString(),
  };
  await putItem({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: planSk(), ...item });
  return refundedCents;
};

/**
 * Removes an organization's plan copy from a team that left it.
 *
 * @param orgId - The organization.
 * @param teamId - The team.
 */
export const clearOrgPlanFromTeam = async (orgId: string, teamId: string): Promise<void> => {
  const current = await getItem<PlanItem>(teamPk(teamId), planSk());
  if (current?.orgId === orgId) await deleteItem(teamPk(teamId), planSk());
};

/**
 * Copies an organization's plan onto every member team, after a subscription change.
 *
 * Every team is tried even if one fails (say, a refund Stripe refuses); the
 * first failure is thrown afterwards so the webhook is retried. A retry skips
 * teams already done, since their own plans are marked cancelled.
 *
 * @param orgId - The organization.
 */
export const syncOrgPlanToTeams = async (orgId: string): Promise<void> => {
  const plan = await loadOrgPlan(orgId);
  let failure: unknown;
  for (const teamId of await memberTeamIds(orgId)) {
    try {
      await copyOrgPlanToTeam(orgId, teamId, plan);
    } catch (error) {
      console.error(JSON.stringify({ event: 'org_plan_copy_failed', orgId, teamId, error: error instanceof Error ? error.message : String(error) }));
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
};
