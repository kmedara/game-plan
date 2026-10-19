/**
 * Billing Lambda HTTP coverage with an in-memory DynamoDB store and a fake Stripe.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamRole } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import {
  TABLE_PK,
  TABLE_SK,
  billingSk,
  planSk,
  profileSk,
  rolePermissionsSk,
  stripeCustomerPk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userPk,
} from '../../lib/dynamo/keys.js';
import type { VerifiedStripeEvent } from '../../lib/stripe-client.js';
import type { BillingGateway } from './gateway.js';

const { put, get, clear } = memoryTable;

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

const { handler } = await import('./handler.js');
const { handler: webhookHandler } = await import('./webhook-handler.js');
const { setBillingGateway } = await import('./gateway.js');
const { loadTeamPlan } = await import('../../lib/entitlements.js');

/** Signature the fake gateway accepts. */
const GOOD_SIGNATURE = 't=1,v1=good';

/** Builds a minimal HTTP API event. */
const httpEvent = (
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; query?: Record<string, string> } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.headers ?? {},
    queryStringParameters: options.query,
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

/** Calls a handler and narrows the result. */
const call = async (
  event: APIGatewayProxyEventV2,
  target: (event: APIGatewayProxyEventV2) => unknown = handler,
): Promise<APIGatewayProxyStructuredResultV2> => (await target(event)) as APIGatewayProxyStructuredResultV2;

/** Parses a JSON response body. */
const bodyOf = (result: APIGatewayProxyStructuredResultV2): Record<string, unknown> =>
  JSON.parse(result.body ?? '{}') as Record<string, unknown>;

/** A signed-in adult with a stored profile. */
const makeUser = (): { userId: string; authorization: string } => {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  put({ [TABLE_PK]: userPk(userId), [TABLE_SK]: profileSk(), userId, email, displayName: 'Pat', accountKind: 'adult' });
  return { userId, authorization: `Bearer ${issueLocalTokens(userId, email).accessToken}` };
};

/** Seeds a team with an admin and a player, using the default permission matrix. */
const seedTeam = (): { teamId: string; admin: ReturnType<typeof makeUser>; player: ReturnType<typeof makeUser> } => {
  const teamId = randomUUID();
  const admin = makeUser();
  const player = makeUser();
  put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMetaSk(), teamId, name: 'Hawks', timeZone: 'UTC' });
  const roster: [string, TeamRole][] = [
    [admin.userId, 'team_admin'],
    [player.userId, 'player'],
  ];
  for (const [userId, role] of roster) {
    put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMemberSk(userId), userId, role });
  }
  for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: rolePermissionsSk(role), role, permissions: [...permissions] });
  }
  return { teamId, admin, player };
};

/** Pending webhook payload for {@link fakeGateway}'s `verifyWebhook`. */
let nextEvent: VerifiedStripeEvent | undefined;

const fakeGateway = {
  priceId: vi.fn(async (lookupKey: string) => `price_${lookupKey}`),
  createCheckoutSession: vi.fn(async () => ({ url: 'https://checkout.stripe.test/sub' })),
  createPortalSession: vi.fn(async () => ({ url: 'https://billing.stripe.test/portal' })),
  verifyWebhook: vi.fn(async (_raw: string, signature: string) => {
    if (signature !== GOOD_SIGNATURE || nextEvent === undefined) throw new Error('invalid_signature');
    return nextEvent;
  }),
} satisfies BillingGateway;

/** Sends a signed webhook to the webhook-only function. */
const deliver = async (type: string, object: Record<string, unknown>, created: number) => {
  nextEvent = { id: `evt_${randomUUID()}`, type, created, object };
  return call(httpEvent('POST', '/billing/webhook', { headers: { 'stripe-signature': GOOD_SIGNATURE }, body: '{}' }), webhookHandler);
};

/** A Stripe subscription object for the premium plan. */
const subscription = (teamId: string | undefined, status: string, interval: 'month' | 'year' = 'year') => ({
  id: 'sub_1',
  customer: 'cus_1',
  status,
  cancel_at_period_end: false,
  ...(teamId !== undefined ? { metadata: { teamId } } : { metadata: {} }),
  items: {
    data: [
      {
        price: { lookup_key: `premium_${interval === 'year' ? 'yearly' : 'monthly'}`, recurring: { interval } },
        current_period_end: 1_825_000_000,
      },
    ],
  },
});

beforeEach(() => {
  clear();
  nextEvent = undefined;
  vi.clearAllMocks();
  setBillingGateway(fakeGateway);
});

afterEach(() => setBillingGateway(undefined));

describe('team plan status', () => {
  it('shows a free plan to any member', async () => {
    const { teamId, player } = seedTeam();
    const result = await call(httpEvent('GET', `/billing/teams/${teamId}`, { headers: { authorization: player.authorization } }));
    expect(bodyOf(result)).toEqual({ teamId, plan: { tier: 'free', status: 'active' }, hasBillingAccount: false });
  });
});

describe('checkout', () => {
  it('lets only billing managers subscribe, at the chosen interval', async () => {
    const { teamId, admin, player } = seedTeam();
    const path = `/billing/teams/${teamId}/checkout`;

    const denied = await call(httpEvent('POST', path, { headers: { authorization: player.authorization }, body: { interval: 'year' } }));
    expect(denied.statusCode).toBe(403);

    const opened = await call(
      httpEvent('POST', path, { headers: { authorization: admin.authorization }, body: { interval: 'year', returnTo: 'web' } }),
    );
    expect(opened.statusCode).toBe(200);
    expect(bodyOf(opened).url).toBe('https://checkout.stripe.test/sub');
    expect(fakeGateway.priceId).toHaveBeenCalledWith('premium_yearly');
    expect(fakeGateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        priceId: 'price_premium_yearly',
        metadata: { teamId, scope: 'team', purchasedBy: admin.userId },
        successUrl: `http://localhost:4200/api/billing/return?to=web&result=subscribed&teamId=${teamId}`,
      }),
    );
  });

  it('sends a paying team to the portal and an organization team to its organization', async () => {
    const { teamId, admin } = seedTeam();
    const path = `/billing/teams/${teamId}/checkout`;
    const headers = { authorization: admin.authorization };

    put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: planSk(), teamId, tier: 'premium', status: 'active', version: 1 });
    const paying = await call(httpEvent('POST', path, { headers, body: { interval: 'month' } }));
    expect(paying.statusCode).toBe(409);
    expect(bodyOf(paying)).toEqual({ error: 'already_subscribed' });

    put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: planSk(), teamId, tier: 'organization', status: 'active', orgId: 'org-1', version: 1 });
    const managed = await call(httpEvent('POST', path, { headers, body: { interval: 'month' } }));
    expect(bodyOf(managed)).toEqual({ error: 'managed_by_organization' });
  });
});

describe('billing portal', () => {
  it('needs a Stripe customer first', async () => {
    const { teamId, admin } = seedTeam();
    const path = `/billing/teams/${teamId}/portal`;
    const headers = { authorization: admin.authorization };

    expect((await call(httpEvent('POST', path, { headers, body: {} }))).statusCode).toBe(404);

    put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: billingSk(), teamId, customerId: 'cus_1', updatedAt: '' });
    const opened = await call(httpEvent('POST', path, { headers, body: {} }));
    expect(bodyOf(opened).url).toBe('https://billing.stripe.test/portal');
    expect(fakeGateway.createPortalSession).toHaveBeenCalledWith('cus_1', expect.stringContaining('result=portal'));
  });
});

describe('billing webhook', () => {
  it('rejects a bad signature, and the main function does not serve the webhook route', async () => {
    const bad = await call(httpEvent('POST', '/billing/webhook', { headers: { 'stripe-signature': 'nope' }, body: '{}' }), webhookHandler);
    expect(bad.statusCode).toBe(400);
    const elsewhere = await call(httpEvent('GET', '/billing/teams/t1'), webhookHandler);
    expect(elsewhere.statusCode).toBe(404);
  });

  it('records the customer, applies subscription changes in order, and ends on cancel', async () => {
    const { teamId } = seedTeam();

    await deliver('checkout.session.completed', { mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', metadata: { teamId } }, 100);
    expect(get(teamPk(teamId), billingSk())).toMatchObject({ customerId: 'cus_1', subscriptionId: 'sub_1' });
    expect(get(stripeCustomerPk('cus_1'), 'TEAM')).toMatchObject({ teamId });

    await deliver('customer.subscription.created', subscription(teamId, 'active'), 101);
    expect(await loadTeamPlan(teamId)).toEqual({
      tier: 'premium',
      status: 'active',
      interval: 'year',
      currentPeriodEnd: new Date(1_825_000_000 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });

    // An older event delivered late changes nothing.
    await deliver('customer.subscription.updated', subscription(teamId, 'past_due'), 99);
    expect((await loadTeamPlan(teamId)).status).toBe('active');

    // A subscription without metadata is found through its customer.
    await deliver('customer.subscription.updated', subscription(undefined, 'past_due'), 102);
    expect((await loadTeamPlan(teamId)).status).toBe('past_due');

    await deliver('customer.subscription.deleted', subscription(teamId, 'canceled'), 103);
    expect(await loadTeamPlan(teamId)).toMatchObject({ tier: 'premium', status: 'canceled' });
  });

  it('ignores a subscription whose first payment is still pending', async () => {
    const { teamId } = seedTeam();
    await deliver('customer.subscription.created', subscription(teamId, 'incomplete'), 100);
    expect(get(teamPk(teamId), planSk())).toBeUndefined();
  });
});

describe('returning from Stripe', () => {
  it('redirects to the app deep link or the team page', async () => {
    const app = await call(httpEvent('GET', '/billing/return', { query: { to: 'app', result: 'subscribed', teamId: 't1' } }));
    expect(app.headers?.location).toBe('gameplan://billing?result=subscribed&teamId=t1');
    const web = await call(httpEvent('GET', '/billing/return', { query: { to: 'web', result: 'portal', teamId: 't1' } }));
    expect(web.headers?.location).toBe('http://localhost:4200/teams/t1?result=portal&teamId=t1');
  });
});
