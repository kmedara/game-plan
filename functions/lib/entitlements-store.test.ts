/**
 * Plan rows load as wire plans, and the entitlement guard refuses what a plan lacks.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from './dynamo/memory-table.js';
import { planSk, TABLE_PK, TABLE_SK, teamPk } from './dynamo/keys.js';

vi.mock('./dynamo/access.js', async () => (await import('./dynamo/memory-table.js')).memoryAccess);

const { loadTeamPlan, mapPlanError, requireEntitlement } = await import('./entitlements.js');
const { route } = await import('./pipeline.js');
const { json } = await import('./http.js');
const { withMappedErrors } = await import('./pipeline.js');

const event = (path: string): APIGatewayProxyEventV2 =>
  ({ version: '2.0', rawPath: path, headers: {}, requestContext: { http: { method: 'GET', path } } }) as APIGatewayProxyEventV2;

const waiversRoute = route(
  'GET',
  '/teams/:teamId/waivers',
  withMappedErrors(mapPlanError),
  requireEntitlement('waivers'),
  async ({ entitlements }) => json(200, { tier: entitlements.tier }),
);

beforeEach(() => memoryTable.clear());

describe('loadTeamPlan', () => {
  it('reads a stored plan and treats a team without one as free', async () => {
    memoryTable.put({
      [TABLE_PK]: teamPk('t1'),
      [TABLE_SK]: planSk(),
      teamId: 't1',
      tier: 'premium',
      status: 'active',
      interval: 'year',
      currentPeriodEnd: '2027-10-19T00:00:00.000Z',
      stripeEventCreated: 1,
    });
    expect(await loadTeamPlan('t1')).toEqual({
      tier: 'premium',
      status: 'active',
      interval: 'year',
      currentPeriodEnd: '2027-10-19T00:00:00.000Z',
    });
    expect(await loadTeamPlan('t2')).toEqual({ tier: 'free', status: 'active' });
  });
});

describe('requireEntitlement', () => {
  it('answers 402 plan_required on a free team and passes a premium one', async () => {
    const refused = await waiversRoute(event('/teams/t1/waivers'));
    expect(refused.statusCode).toBe(402);
    expect(JSON.parse(refused.body ?? '{}')).toEqual({ error: 'plan_required' });

    memoryTable.put({ [TABLE_PK]: teamPk('t1'), [TABLE_SK]: planSk(), teamId: 't1', tier: 'premium', status: 'active' });
    const allowed = await waiversRoute(event('/teams/t1/waivers'));
    expect(allowed.statusCode).toBe(200);
    expect(JSON.parse(allowed.body ?? '{}')).toEqual({ tier: 'premium' });
  });
});
