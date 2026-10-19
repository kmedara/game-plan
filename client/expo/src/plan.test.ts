/**
 * Plan gating on the device: entitlements from the team summary, where plans can be bought.
 */

import { canBuyPlansOn, paysOwnPlan, teamEntitlements } from './plan';

describe('teamEntitlements', () => {
  it('treats a summary without a plan as free and opens features on premium', () => {
    expect(teamEntitlements(undefined)).toMatchObject({ tier: 'free', video: false });
    expect(teamEntitlements({})).toMatchObject({ tier: 'free' });
    expect(teamEntitlements({ plan: { tier: 'premium', status: 'active' } })).toMatchObject({ tier: 'premium', video: true });
  });
});

describe('canBuyPlansOn', () => {
  it('allows web and Android always, and iOS only with the store flag', () => {
    expect(canBuyPlansOn('web', false)).toBe(true);
    expect(canBuyPlansOn('android', false)).toBe(true);
    expect(canBuyPlansOn('ios', false)).toBe(false);
    expect(canBuyPlansOn('ios', true)).toBe(true);
  });
});

describe('paysOwnPlan', () => {
  it('is true only for a team paying for its own live plan', () => {
    expect(paysOwnPlan({ tier: 'premium', status: 'active' })).toBe(true);
    expect(paysOwnPlan({ tier: 'premium', status: 'past_due' })).toBe(true);
    expect(paysOwnPlan({ tier: 'free', status: 'active' })).toBe(false);
    expect(paysOwnPlan({ tier: 'premium', status: 'canceled' })).toBe(false);
    expect(paysOwnPlan({ tier: 'organization', status: 'active', orgId: 'o1' })).toBe(false);
    expect(paysOwnPlan(undefined)).toBe(false);
  });
});
