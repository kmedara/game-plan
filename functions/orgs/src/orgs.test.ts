/**
 * Organizations: ownership, admins, teams joining and leaving (a paying team's
 * own plan is cancelled with a refund), admin access to member teams, plan
 * copying, extra-team billing, and announcements.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import {
  MESSAGE_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  chatMetaSk,
  chatPk,
  orgPk,
  planSk,
  profileSk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  billingSk,
} from '../../lib/dynamo/keys.js';

const { fanoutJobs, seatCalls, cancelled } = vi.hoisted(() => ({
  fanoutJobs: [] as Array<Record<string, unknown>>,
  seatCalls: [] as Array<[string, number]>,
  cancelled: [] as Array<{ customerId: string; subscriptionId: string }>,
}));

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);
vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (job: Record<string, unknown>): Promise<void> => {
    fanoutJobs.push(job);
  },
  resetFanoutSqsClient: (): void => undefined,
}));
// The email index is not modeled by the memory table; look the profile up directly.
vi.mock('../../lib/auth/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/auth/index.js')>();
  const { memoryTable: table } = await import('../../lib/dynamo/memory-table.js');
  return {
    ...actual,
    findProfileByEmail: async (email: string) =>
      [...table.store.values()].find((row) => row.SK === 'PROFILE' && row.email === email) as never,
  };
});

const { handler: orgs } = await import('./handler.js');
const { handler: teams } = await import('../../teams/src/handler.js');
const { setSeatUpdater } = await import('../../lib/org-seats.js');
const { setSubscriptionCanceller } = await import('../../lib/team-subscription.js');
const { loadTeamEntitlements } = await import('../../lib/entitlements.js');
const { applyBillingEvent } = await import('../../billing/src/webhook.js');

type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;

const call = async (handle: Handler, method: string, path: string, userId: string, body?: unknown) => {
  const result = await handle({
    version: '2.0',
    rawPath: path,
    headers: {
      authorization: `Bearer ${issueLocalTokens(userId, `${userId}@example.com`).accessToken}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, path } },
  } as unknown as APIGatewayProxyEventV2);
  return { status: result.statusCode, body: JSON.parse(String(result.body || '{}')) as Record<string, unknown> };
};

const profile = (userId: string, accountKind: 'adult' | 'minor'): void => {
  memoryTable.put({
    [TABLE_PK]: `USER#${userId}`,
    [TABLE_SK]: profileSk(),
    userId,
    email: `${userId}@example.com`,
    displayName: `Name ${userId}`,
    accountKind,
    createdAt: '2026-01-01',
  });
};

/** A team with a coach-admin who manages billing and a player who does not. */
const seedTeam = (teamId: string, adminId = `${teamId}-admin`): void => {
  memoryTable.put({
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMetaSk(),
    teamId,
    name: `Team ${teamId}`,
    timeZone: 'UTC',
    defaultChatId: `${teamId}-chat`,
    createdBy: adminId,
    createdAt: '2026-01-01',
  });
  memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMemberSk(adminId), userId: adminId, role: 'team_admin' });
  memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMemberSk(`${teamId}-player`), userId: `${teamId}-player`, role: 'player' });
  memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: rolePermissionsSk('player'), role: 'player', permissions: [] });
  memoryTable.put({ [TABLE_PK]: chatPk(`${teamId}-chat`), [TABLE_SK]: chatMetaSk(), chatId: `${teamId}-chat`, kind: 'default', teamId });
};

const createOrg = async (): Promise<string> =>
  ((await call(orgs, 'POST', '/orgs', 'owner', { name: 'Seacoast Club' })).body as { orgId: string }).orgId;

const join = async (orgId: string, teamId: string): Promise<void> => {
  await call(orgs, 'POST', `/orgs/${orgId}/teams/${teamId}`, 'owner');
  const accepted = await call(orgs, 'POST', `/orgs/${orgId}/teams/${teamId}/accept`, `${teamId}-admin`);
  expect(accepted.status).toBe(200);
};

const subscribe = (orgId: string): void => {
  memoryTable.put({ [TABLE_PK]: orgPk(orgId), [TABLE_SK]: planSk(), orgId, tier: 'organization', status: 'active', version: 1 });
};

describe('organizations', () => {
  beforeEach(() => {
    memoryTable.clear();
    fanoutJobs.length = 0;
    seatCalls.length = 0;
    setSeatUpdater(async (subscriptionId, extra) => {
      seatCalls.push([subscriptionId, extra]);
    });
    cancelled.length = 0;
    setSubscriptionCanceller(async (input) => {
      cancelled.push(input);
      return { refundedCents: 412 };
    });
    profile('owner', 'adult');
    profile('helper', 'adult');
    profile('teen', 'minor');
  });
  afterEach(() => {
    setSeatUpdater(undefined);
    setSubscriptionCanceller(undefined);
  });

  it('lets adults create one, the owner add adult admins, and nobody remove the owner', async () => {
    expect((await call(orgs, 'POST', '/orgs', 'teen', { name: 'Kids Club' })).body).toEqual({ error: 'minor_cannot_own_organization' });
    const orgId = await createOrg();
    expect((await call(orgs, 'GET', '/orgs', 'owner')).body).toEqual({
      orgs: [expect.objectContaining({ orgId, name: 'Seacoast Club', isOwner: true, teamCount: 0, plan: { tier: 'free', status: 'active' } })],
    });
    expect((await call(orgs, 'POST', `/orgs/${orgId}/admins`, 'owner', { email: 'teen@example.com' })).status).toBe(403);
    const added = await call(orgs, 'POST', `/orgs/${orgId}/admins`, 'owner', { email: 'helper@example.com' });
    expect((added.body.admins as { userId: string }[]).map((admin) => admin.userId).sort()).toEqual(['helper', 'owner']);
    expect((await call(orgs, 'POST', `/orgs/${orgId}/admins`, 'helper', { email: 'teen@example.com' })).status).toBe(403);
    expect((await call(orgs, 'DELETE', `/orgs/${orgId}/admins/owner`, 'helper')).body).toEqual({ error: 'owner_cannot_leave' });
    expect((await call(orgs, 'GET', `/orgs/${orgId}`, 'someone')).status).toBe(403);
  });

  it('joins a team only when its billing manager accepts, then treats org admins as team admins', async () => {
    seedTeam('hawks');
    const orgId = await createOrg();
    expect((await call(teams, 'GET', '/teams/hawks', 'owner')).status).toBe(403);

    await call(orgs, 'POST', `/orgs/${orgId}/teams/hawks`, 'owner');
    expect((await call(orgs, 'GET', '/orgs/teams/hawks', 'hawks-player')).body).toEqual({
      invites: [{ orgId, name: 'Seacoast Club' }],
    });
    expect((await call(orgs, 'POST', `/orgs/${orgId}/teams/hawks/accept`, 'hawks-player')).status).toBe(403);
    expect((await call(teams, 'GET', '/teams/hawks', 'owner')).status).toBe(403);

    await call(orgs, 'POST', `/orgs/${orgId}/teams/hawks/accept`, 'hawks-admin');
    expect((await call(orgs, 'GET', '/orgs/teams/hawks', 'hawks-player')).body).toEqual({
      org: { orgId, name: 'Seacoast Club' },
      invites: [],
    });
    const detail = (await call(orgs, 'GET', `/orgs/${orgId}`, 'owner')).body;
    expect(detail).toMatchObject({ teamCount: 1, extraTeams: 0, teams: [{ teamId: 'hawks', memberCount: 2, pending: false }] });

    const asAdmin = await call(teams, 'GET', '/teams/hawks', 'owner');
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toMatchObject({ role: 'team_admin' });

    expect((await call(orgs, 'DELETE', `/orgs/${orgId}/teams/hawks`, 'hawks-player')).status).toBe(403);
    expect((await call(orgs, 'DELETE', `/orgs/${orgId}/teams/hawks`, 'hawks-admin')).status).toBe(204);
    expect((await call(teams, 'GET', '/teams/hawks', 'owner')).status).toBe(403);
  });

  it('copies the organization plan onto member teams and takes it away when they leave', async () => {
    seedTeam('hawks');
    const orgId = await createOrg();
    subscribe(orgId);
    await join(orgId, 'hawks');
    expect((await loadTeamEntitlements('hawks')).tier).toBe('organization');
    expect(memoryTable.get(teamPk('hawks'), planSk())).toMatchObject({ orgId, tier: 'organization' });

    await call(orgs, 'DELETE', `/orgs/${orgId}/teams/hawks`, 'owner');
    expect((await loadTeamEntitlements('hawks')).tier).toBe('free');
  });

  it('cancels a paying team’s own plan with a refund on joining, and leaves it on free after leaving', async () => {
    seedTeam('hawks');
    memoryTable.put({ [TABLE_PK]: teamPk('hawks'), [TABLE_SK]: planSk(), teamId: 'hawks', tier: 'premium', status: 'active' });
    memoryTable.put({ [TABLE_PK]: teamPk('hawks'), [TABLE_SK]: billingSk(), teamId: 'hawks', customerId: 'cus_h', subscriptionId: 'sub_h' });
    const orgId = await createOrg();
    subscribe(orgId);
    await call(orgs, 'POST', `/orgs/${orgId}/teams/hawks`, 'owner');

    const accepted = await call(orgs, 'POST', `/orgs/${orgId}/teams/hawks/accept`, 'hawks-admin');
    expect(accepted.body).toMatchObject({ org: { orgId }, refundedCents: 412 });
    expect(cancelled).toEqual([{ customerId: 'cus_h', subscriptionId: 'sub_h' }]);
    expect((await loadTeamEntitlements('hawks')).tier).toBe('organization');

    await call(orgs, 'DELETE', `/orgs/${orgId}/teams/hawks`, 'hawks-admin');
    expect((await loadTeamEntitlements('hawks')).tier).toBe('free');
  });

  it('keeps the team out when cancelling its plan fails, and does not cancel a free team', async () => {
    seedTeam('hawks');
    seedTeam('owls');
    memoryTable.put({ [TABLE_PK]: teamPk('hawks'), [TABLE_SK]: planSk(), teamId: 'hawks', tier: 'premium', status: 'active' });
    memoryTable.put({ [TABLE_PK]: teamPk('hawks'), [TABLE_SK]: billingSk(), teamId: 'hawks', customerId: 'cus_h', subscriptionId: 'sub_h' });
    const orgId = await createOrg();
    await call(orgs, 'POST', `/orgs/${orgId}/teams/hawks`, 'owner');
    setSubscriptionCanceller(async () => {
      throw new Error('billing_not_configured');
    });
    expect((await call(orgs, 'POST', `/orgs/${orgId}/teams/hawks/accept`, 'hawks-admin')).status).toBe(503);
    expect((await call(orgs, 'GET', '/orgs/teams/hawks', 'hawks-admin')).body).toMatchObject({ invites: [{ orgId }] });
    expect((await loadTeamEntitlements('hawks')).tier).toBe('premium');

    cancelled.length = 0;
    setSubscriptionCanceller(async (input) => {
      cancelled.push(input);
      return { refundedCents: 0 };
    });
    await join(orgId, 'owls');
    expect(cancelled).toEqual([]);
  });

  it('bills each team past five as an extra team', async () => {
    const orgId = await createOrg();
    memoryTable.put({ [TABLE_PK]: orgPk(orgId), [TABLE_SK]: billingSk(), orgId, customerId: 'cus_1', subscriptionId: 'sub_1' });
    for (const id of ['t1', 't2', 't3', 't4', 't5', 't6']) {
      seedTeam(id);
      await join(orgId, id);
    }
    expect(seatCalls.at(-1)).toEqual(['sub_1', 1]);
    await call(orgs, 'DELETE', `/orgs/${orgId}/teams/t6`, 'owner');
    expect(seatCalls.at(-1)).toEqual(['sub_1', 0]);
  });

  it('posts announcements to member teams only on the organization plan', async () => {
    seedTeam('hawks');
    const orgId = await createOrg();
    await join(orgId, 'hawks');
    expect((await call(orgs, 'POST', `/orgs/${orgId}/announcements`, 'owner', { body: 'Fields closed Saturday' })).status).toBe(402);

    subscribe(orgId);
    expect((await call(orgs, 'POST', `/orgs/${orgId}/announcements`, 'owner', { body: 'Fields closed Saturday' })).body).toEqual({
      sent: 1,
    });
    const messages = [...memoryTable.store.values()].filter(
      (row) => row.PK === chatPk('hawks-chat') && String(row.SK).startsWith(MESSAGE_SK_PREFIX),
    );
    expect(messages).toEqual([expect.objectContaining({ senderId: 'owner', body: 'Seacoast Club: Fields closed Saturday' })]);
    expect(fanoutJobs).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'chat_message', chatId: 'hawks-chat' })]));
  });

  it('applies an organization subscription from Stripe to the organization and its teams', async () => {
    seedTeam('hawks');
    const orgId = await createOrg();
    await join(orgId, 'hawks');
    await applyBillingEvent({
      id: 'evt_1',
      type: 'customer.subscription.created',
      created: 100,
      object: {
        id: 'sub_9',
        status: 'active',
        customer: 'cus_9',
        metadata: { orgId, scope: 'organization' },
        cancel_at_period_end: false,
        items: {
          data: [
            { price: { lookup_key: 'org_extra_team_yearly', recurring: { interval: 'year' } }, current_period_end: 2000000000 },
            { price: { lookup_key: 'org_yearly', recurring: { interval: 'year' } }, current_period_end: 2000000000 },
          ],
        },
      },
    });
    expect(memoryTable.get(orgPk(orgId), planSk())).toMatchObject({ tier: 'organization', interval: 'year', status: 'active' });
    expect((await loadTeamEntitlements('hawks')).tier).toBe('organization');
    expect(memoryTable.get(orgPk(orgId), billingSk())).toMatchObject({ customerId: 'cus_9', subscriptionId: 'sub_9' });
  });
});
