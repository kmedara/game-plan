/**
 * Storage for team subscriptions: the Stripe customer and the plan row.
 *
 * `TEAM#<teamId>` / `BILLING` holds the Stripe customer and subscription ids.
 * `STRIPE_CUSTOMER#<customerId>` / `TEAM` maps a customer back to its team.
 * `TEAM#<teamId>` / `PLAN` is what entitlements read.
 *
 * Stripe may deliver events out of order or more than once. A plan write is
 * skipped when the stored row came from a newer event, and every write is
 * conditional on the row's `version`, so two deliveries cannot interleave.
 */

import type { BillingInterval, PlanStatus, PlanTier } from '@gameplan/types';
import {
  TABLE_PK,
  TABLE_SK,
  billingSk,
  getItem,
  orgPk,
  planSk,
  putItem,
  stripeCustomerPk,
  teamPk,
  transactWrite,
} from '../../lib/dynamo/index.js';
import type { PlanItem } from '../../lib/entitlements.js';
import { TABLE_NAME } from '../../lib/names.js';
import type { OrgBillingItem } from '../../lib/org-seats.js';
import { loadOrgPlan, syncOrgPlanToTeams, type OrgPlanItem } from '../../lib/orgs.js';

/** `TEAM#<teamId>` / `BILLING`. */
export type BillingItem = {
  teamId: string;
  customerId: string;
  subscriptionId?: string;
  updatedAt: string;
};

/** Plan row as stored, with its write version. */
type StoredPlan = PlanItem & { version?: number };

/** A subscription reduced to what the plan row needs. */
export type SubscriptionFacts = {
  tier: PlanTier;
  status: PlanStatus;
  interval?: BillingInterval;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  subscriptionId: string;
};

/**
 * Loads a team's Stripe customer, if it has one.
 *
 * @param teamId - The team.
 * @returns The billing row, or `undefined` before the first checkout.
 */
export const getTeamBilling = async (teamId: string): Promise<BillingItem | undefined> =>
  getItem<BillingItem>(teamPk(teamId), billingSk());

/**
 * Finds the team a Stripe customer pays for.
 *
 * @param customerId - The Stripe customer id.
 * @returns The team id, or `undefined` for an unknown customer.
 */
export const teamIdForCustomer = async (customerId: string): Promise<string | undefined> =>
  (await getItem<{ teamId?: string }>(stripeCustomerPk(customerId), 'TEAM'))?.teamId;

/**
 * Stores a team's Stripe customer and subscription, and the reverse lookup.
 *
 * @param teamId - The team.
 * @param customerId - The Stripe customer id.
 * @param subscriptionId - The subscription id, when known.
 */
export const saveTeamBilling = async (teamId: string, customerId: string, subscriptionId?: string): Promise<void> => {
  const item: BillingItem = {
    teamId,
    customerId,
    ...(subscriptionId !== undefined ? { subscriptionId } : {}),
    updatedAt: new Date().toISOString(),
  };
  await transactWrite([
    { Put: { TableName: TABLE_NAME, Item: { [TABLE_PK]: teamPk(teamId), [TABLE_SK]: billingSk(), ...item } } },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: { [TABLE_PK]: stripeCustomerPk(customerId), [TABLE_SK]: 'TEAM', customerId, teamId },
      },
    },
  ]);
};

/**
 * Writes a team's plan from a subscription event, unless a newer event already did.
 *
 * @param teamId - The team.
 * @param facts - The subscription's tier, status, and period.
 * @param eventCreated - Unix seconds when Stripe created the event.
 * @returns `true` when the row was written, `false` when the event was stale.
 * @throws `ConditionalCheckFailedException` when another delivery wrote first; Stripe retries.
 */
export const applySubscription = async (
  teamId: string,
  facts: SubscriptionFacts,
  eventCreated: number,
): Promise<boolean> => {
  const stored = await getItem<StoredPlan>(teamPk(teamId), planSk());
  if (stored?.stripeEventCreated !== undefined && stored.stripeEventCreated > eventCreated) return false;
  // An organization's plan is managed by the organization, not this team's own subscription.
  if (stored?.orgId !== undefined) return false;
  const version = stored?.version ?? 0;
  const item: StoredPlan = {
    teamId,
    tier: facts.tier,
    status: facts.status,
    ...(facts.interval !== undefined ? { interval: facts.interval } : {}),
    ...(facts.currentPeriodEnd !== undefined ? { currentPeriodEnd: facts.currentPeriodEnd } : {}),
    cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
    stripeEventCreated: eventCreated,
    updatedAt: new Date().toISOString(),
    version: version + 1,
  };
  await putItem(
    { [TABLE_PK]: teamPk(teamId), [TABLE_SK]: planSk(), ...item },
    stored === undefined
      ? { conditionExpression: 'attribute_not_exists(PK)' }
      : {
          conditionExpression: '#version = :version',
          expressionAttributeNames: { '#version': 'version' },
          expressionAttributeValues: { ':version': version },
        },
  );
  return true;
};

/**
 * Finds the organization a Stripe customer pays for.
 *
 * @param customerId - The Stripe customer id.
 * @returns The organization id, or `undefined`.
 */
export const orgIdForCustomer = async (customerId: string): Promise<string | undefined> =>
  (await getItem<{ orgId?: string }>(stripeCustomerPk(customerId), 'ORG'))?.orgId;

/**
 * An organization's Stripe customer, if it has one.
 *
 * @param orgId - The organization.
 * @returns The billing row.
 */
export const getOrgBilling = async (orgId: string): Promise<OrgBillingItem | undefined> =>
  getItem<OrgBillingItem>(orgPk(orgId), billingSk());

/**
 * Stores an organization's Stripe customer and subscription, and the reverse lookup.
 *
 * @param orgId - The organization.
 * @param customerId - The Stripe customer id.
 * @param subscriptionId - The subscription id, when known.
 */
export const saveOrgBilling = async (orgId: string, customerId: string, subscriptionId?: string): Promise<void> => {
  const item: OrgBillingItem = {
    orgId,
    customerId,
    ...(subscriptionId !== undefined ? { subscriptionId } : {}),
    updatedAt: new Date().toISOString(),
  };
  await transactWrite([
    { Put: { TableName: TABLE_NAME, Item: { [TABLE_PK]: orgPk(orgId), [TABLE_SK]: billingSk(), ...item } } },
    { Put: { TableName: TABLE_NAME, Item: { [TABLE_PK]: stripeCustomerPk(customerId), [TABLE_SK]: 'ORG', customerId, orgId } } },
  ]);
};

/**
 * Writes an organization's plan from a subscription event, unless a newer
 * event already did, then copies it onto every member team.
 *
 * @param orgId - The organization.
 * @param facts - The subscription's tier, status, and period.
 * @param eventCreated - Unix seconds when Stripe created the event.
 * @returns `true` when the plan was written.
 * @throws `ConditionalCheckFailedException` when another delivery wrote first; Stripe retries.
 */
export const applyOrgSubscription = async (
  orgId: string,
  facts: SubscriptionFacts,
  eventCreated: number,
): Promise<boolean> => {
  const stored = await loadOrgPlan(orgId);
  if (stored?.stripeEventCreated !== undefined && stored.stripeEventCreated > eventCreated) return false;
  const version = stored?.version ?? 0;
  const item: OrgPlanItem = {
    orgId,
    tier: facts.tier,
    status: facts.status,
    ...(facts.interval !== undefined ? { interval: facts.interval } : {}),
    ...(facts.currentPeriodEnd !== undefined ? { currentPeriodEnd: facts.currentPeriodEnd } : {}),
    cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
    stripeEventCreated: eventCreated,
    updatedAt: new Date().toISOString(),
    version: version + 1,
  };
  await putItem(
    { [TABLE_PK]: orgPk(orgId), [TABLE_SK]: planSk(), ...item },
    stored === undefined
      ? { conditionExpression: 'attribute_not_exists(PK)' }
      : {
          conditionExpression: '#version = :version',
          expressionAttributeNames: { '#version': 'version' },
          expressionAttributeValues: { ':version': version },
        },
  );
  await syncOrgPlanToTeams(orgId);
  return true;
};
