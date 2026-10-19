/**
 * What a team's plan unlocks on this device, and whether plans can be bought here.
 *
 * Limits come from `entitlementsFor` in `@gameplan/rules`, the same table the
 * API enforces, so the app hides or prompts before a request would fail.
 */

import { Platform } from 'react-native';
import { entitlementsFor, type Entitlements } from '@gameplan/rules';
import type { PlanTier, TeamPlan, TeamSummary } from '@gameplan/types';
import { config } from './config';

/**
 * What a team's plan unlocks. A summary cached before plans existed counts as free.
 *
 * @param team - The team summary, if loaded.
 * @returns The team's entitlements.
 */
export const teamEntitlements = (team: Pick<TeamSummary, 'plan'> | undefined): Entitlements =>
  entitlementsFor(team?.plan !== undefined ? { teamPlan: team.plan } : {});

/**
 * Whether this device may show prices and open web checkout.
 *
 * Apple allows an iOS app to link out to web payment only in some storefronts,
 * so iOS needs the build flag; Android and the website always may.
 *
 * @param os - `Platform.OS`.
 * @param iosWebUpgrade - The `EXPO_PUBLIC_IOS_WEB_UPGRADE` flag.
 * @returns `true` when prices and buy buttons may show.
 */
export const canBuyPlansOn = (os: string, iosWebUpgrade: boolean): boolean => os !== 'ios' || iosWebUpgrade;

/** {@link canBuyPlansOn} for this device and build. */
export const canBuyPlansHere = (): boolean => canBuyPlansOn(Platform.OS, config.iosWebUpgrade);

/**
 * Translation key for a tier name.
 *
 * @param tier - The plan tier.
 * @returns A catalog key.
 */
export const planNameKey = (tier: PlanTier): string => `plans.tier.${tier}`;

/**
 * Whether a team pays for its own plan, so the billing portal applies.
 *
 * @param plan - The team's plan.
 * @returns `true` for a paid plan that is not an organization's.
 */
export const paysOwnPlan = (plan: TeamPlan | undefined): boolean =>
  plan !== undefined && plan.tier !== 'free' && plan.orgId === undefined && plan.status !== 'canceled';
