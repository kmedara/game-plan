/**
 * Keeps an organization subscription's extra-team quantity equal to its
 * teams past the included ones.
 *
 * Called when a team joins or leaves, and after checkout. The quantity is a
 * second subscription item (`org_extra_team_monthly` or `_yearly`, matching
 * the base price's interval); Stripe prorates each change.
 */

import { ORG_INCLUDED_TEAMS } from '@gameplan/schemas';
import type Stripe from 'stripe';
import { billingSk, getItem, orgPk } from './dynamo/index.js';
import { memberTeamIds } from './orgs.js';
import { stripeClient } from './stripe-client.js';

/** `ORG#<orgId>` / `BILLING`. */
export type OrgBillingItem = { orgId: string; customerId: string; subscriptionId?: string; updatedAt: string };

/** Sets the extra-team quantity on a subscription. Tests replace it with {@link setSeatUpdater}. */
export type SeatUpdater = (subscriptionId: string, extraTeams: number) => Promise<void>;

/**
 * Teams billed beyond the included ones.
 *
 * @param teamCount - Teams in the organization.
 * @returns The extra-team quantity.
 */
export const extraTeamsFor = (teamCount: number): number => Math.max(0, teamCount - ORG_INCLUDED_TEAMS);

/** The live Stripe implementation. */
const stripeSeatUpdater: SeatUpdater = async (subscriptionId, extraTeams) => {
  const stripe: Stripe = await stripeClient('billing_not_configured');
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const items = subscription.items.data;
  const extra = items.find((item) => item.price.lookup_key?.startsWith('org_extra_team') === true);
  if (extra !== undefined) {
    if (extraTeams === 0) await stripe.subscriptionItems.del(extra.id, { proration_behavior: 'create_prorations' });
    else if (extra.quantity !== extraTeams) await stripe.subscriptionItems.update(extra.id, { quantity: extraTeams });
    return;
  }
  if (extraTeams === 0) return;
  const interval = items[0]?.price.recurring?.interval === 'year' ? 'yearly' : 'monthly';
  const prices = await stripe.prices.list({ lookup_keys: [`org_extra_team_${interval}`], active: true, limit: 1 });
  const price = prices.data[0];
  if (price === undefined) throw new Error('billing_not_configured');
  await stripe.subscriptionItems.create({ subscription: subscriptionId, price: price.id, quantity: extraTeams });
};

let override: SeatUpdater | undefined;

/**
 * Replaces the Stripe call, for tests. Pass `undefined` to restore Stripe.
 *
 * @param updater - The stand-in.
 */
export const setSeatUpdater = (updater: SeatUpdater | undefined): void => {
  override = updater;
};

/**
 * Brings the organization's extra-team quantity in line with its teams.
 * Does nothing before the organization subscribes.
 *
 * @param orgId - The organization.
 */
export const syncOrgSeats = async (orgId: string): Promise<void> => {
  const billing = await getItem<OrgBillingItem>(orgPk(orgId), billingSk());
  if (billing?.subscriptionId === undefined) return;
  const teams = await memberTeamIds(orgId);
  await (override ?? stripeSeatUpdater)(billing.subscriptionId, extraTeamsFor(teams.length));
};
