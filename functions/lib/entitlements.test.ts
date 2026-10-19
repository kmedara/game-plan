/**
 * Plan tiers, the past-due grace period, and what each tier unlocks.
 */

import { describe, expect, it } from 'vitest';
import { effectivePlanTier, entitlementsFor, PLAN_GRACE_MS, showsAds, underLimit } from '@gameplan/rules';

const now = new Date('2026-10-19T12:00:00.000Z');

/** ISO instant `ms` milliseconds before {@link now}. */
const before = (ms: number): string => new Date(now.getTime() - ms).toISOString();

describe('effectivePlanTier', () => {
  it('grants an active or trialing tier and nothing for a canceled one', () => {
    expect(effectivePlanTier({ tier: 'premium', status: 'active' }, now)).toBe('premium');
    expect(effectivePlanTier({ tier: 'organization', status: 'trialing' }, now)).toBe('organization');
    expect(effectivePlanTier({ tier: 'premium', status: 'canceled' }, now)).toBe('free');
    expect(effectivePlanTier(undefined, now)).toBe('free');
  });

  it('keeps a past-due tier for the grace period after the paid period', () => {
    const late = (ms: number) => ({ tier: 'premium' as const, status: 'past_due' as const, currentPeriodEnd: before(ms) });
    expect(effectivePlanTier(late(PLAN_GRACE_MS - 1000), now)).toBe('premium');
    expect(effectivePlanTier(late(PLAN_GRACE_MS + 1000), now)).toBe('free');
    expect(effectivePlanTier({ tier: 'premium', status: 'past_due' }, now)).toBe('free');
  });
});

describe('entitlementsFor', () => {
  it('limits free teams and opens paid features on premium', () => {
    expect(entitlementsFor({}, now)).toMatchObject({
      tier: 'free',
      video: false,
      waivers: false,
      practicePlans: 5,
      aiMonthly: 0,
      adFree: false,
    });
    expect(entitlementsFor({ teamPlan: { tier: 'premium', status: 'active' } }, now)).toMatchObject({
      video: true,
      waivers: true,
      practicePlans: undefined,
      aiMonthly: 200,
      adFree: true,
    });
  });

  it('lets the parent add-on remove ads and unlock full-quality downloads on a free team', () => {
    expect(entitlementsFor({ parentAddOn: true }, now)).toMatchObject({
      tier: 'free',
      adFree: true,
      fullQualityDownloads: true,
      video: false,
    });
  });
});

describe('showsAds', () => {
  it('never shows ads to minors, and hides them for paid teams or the add-on', () => {
    expect(showsAds({ accountKind: 'minor', teamPlans: [] }, now)).toBe(false);
    expect(showsAds({ accountKind: 'adult', teamPlans: [undefined] }, now)).toBe(true);
    expect(showsAds({ accountKind: 'adult', teamPlans: [undefined, { tier: 'premium', status: 'active' }] }, now)).toBe(
      false,
    );
    expect(showsAds({ accountKind: 'adult', teamPlans: [], parentAddOn: true }, now)).toBe(false);
  });
});

describe('underLimit', () => {
  it('allows one more until the limit, and always when there is none', () => {
    expect(underLimit(4, 5)).toBe(true);
    expect(underLimit(5, 5)).toBe(false);
    expect(underLimit(500, undefined)).toBe(true);
  });
});
