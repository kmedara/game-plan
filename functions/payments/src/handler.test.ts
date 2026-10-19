/**
 * Payments Lambda HTTP coverage with an in-memory DynamoDB store and a fake Stripe.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FanoutJob, TeamPermission, TeamRole } from '@gameplan/types';
import { DEFAULT_ROLE_PERMISSIONS } from '@gameplan/types';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import {
  PAYMENT_REMINDERS_PK,
  PAYMENT_REMINDER_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  childSk,
  dueSk,
  guardianSk,
  profileSk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  teamStripeSk,
  userPk,
} from '../../lib/dynamo/keys.js';
import type { GatewayEvent, PaymentGateway } from './stripe.js';

const { store, itemKey, put, get, clear } = memoryTable;

const enqueued: FanoutJob[] = [];

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (job: FanoutJob): Promise<void> => {
    enqueued.push(job);
  },
  resetFanoutSqsClient: (): void => undefined,
}));

const { handler } = await import('./handler.js');
const { setPaymentGateway, platformFeeCents } = await import('./stripe.js');
const { runDuePaymentReminders } = await import('./reminders.js');
const { reminderSchedule } = await import('./payments-store.js');

/** Account id the fake Stripe hands out. */
const ACCOUNT_ID = 'acct_team';

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
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

/** Calls the handler and narrows the result. */
const call = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> =>
  (await handler(event)) as APIGatewayProxyStructuredResultV2;

/** Parses a JSON response body. */
const bodyOf = (result: APIGatewayProxyStructuredResultV2): Record<string, unknown> =>
  JSON.parse(result.body ?? '{}') as Record<string, unknown>;

/** A signed-in user with a stored profile. */
type User = { userId: string; authorization: string };

/**
 * Creates a user with a profile row and a bearer token.
 *
 * @param accountKind - Adult or minor.
 * @param displayName - Profile name.
 * @returns The user id and Authorization header.
 */
const makeUser = (accountKind: 'adult' | 'minor', displayName: string): User => {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  put({
    [TABLE_PK]: userPk(userId),
    [TABLE_SK]: profileSk(),
    userId,
    email,
    displayName,
    accountKind,
    createdAt: new Date().toISOString(),
  });
  const { accessToken } = issueLocalTokens(userId, email);
  return { userId, authorization: `Bearer ${accessToken}` };
};

/**
 * Seeds a team, its permission matrix, and roster rows.
 *
 * @param members - Users and their roles.
 * @param permissions - Role permissions; defaults to the product defaults.
 * @returns The team id.
 */
const seedTeam = (
  members: { user: User; role: TeamRole }[],
  permissions: Partial<Record<TeamRole, readonly TeamPermission[]>> = DEFAULT_ROLE_PERMISSIONS,
): string => {
  const teamId = randomUUID();
  put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMetaSk(), teamId, name: 'Hawks', timeZone: 'UTC' });
  for (const { user, role } of members) {
    put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMemberSk(user.userId), userId: user.userId, role });
  }
  for (const [role, list] of Object.entries(permissions)) {
    put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: rolePermissionsSk(role), role, permissions: [...list] });
  }
  return teamId;
};

/**
 * Links an adult as a minor's guardian on both partitions.
 *
 * @param adult - The guardian.
 * @param minor - The child.
 */
const linkGuardian = (adult: User, minor: User): void => {
  put({ [TABLE_PK]: userPk(minor.userId), [TABLE_SK]: guardianSk(adult.userId), adultId: adult.userId, minorId: minor.userId });
  put({ [TABLE_PK]: userPk(adult.userId), [TABLE_SK]: childSk(minor.userId), adultId: adult.userId, minorId: minor.userId });
};

/**
 * Marks the team's Stripe account ready to take charges.
 *
 * @param teamId - The team.
 */
const enablePayments = (teamId: string): void => {
  put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamStripeSk(), teamId, accountId: ACCOUNT_ID, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, updatedAt: '' });
  put({ [TABLE_PK]: `STRIPE_ACCOUNT#${ACCOUNT_ID}`, [TABLE_SK]: 'TEAM', accountId: ACCOUNT_ID, teamId });
};

/** Pending webhook payload for {@link fakeGateway}'s `verifyWebhook`. */
let nextEvent: GatewayEvent | undefined;

/** Fake Stripe with call counters. */
const fakeGateway = {
  createAccount: vi.fn(async () => ACCOUNT_ID),
  getAccount: vi.fn(async () => ({ chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false })),
  createAccountLink: vi.fn(async () => 'https://connect.stripe.test/onboard'),
  createCheckoutSession: vi.fn(async () => ({ id: `cs_${randomUUID()}`, url: 'https://checkout.stripe.test/pay', status: 'open' as const })),
  getCheckoutSession: vi.fn(async (_account: string, id: string) => ({ id, url: 'https://checkout.stripe.test/pay', status: 'open' as const })),
  paymentIntentMetadata: vi.fn(async () => ({}) as Record<string, string>),
  verifyWebhook: vi.fn(async (_raw: string, signature: string) => {
    if (signature !== GOOD_SIGNATURE || nextEvent === undefined) throw new Error('invalid_signature');
    return nextEvent;
  }),
} satisfies PaymentGateway;

/** Sends a signed webhook carrying `event`. */
const deliverWebhook = async (event: GatewayEvent): Promise<APIGatewayProxyStructuredResultV2> => {
  nextEvent = event;
  return call(
    httpEvent('POST', '/payments/webhook', {
      headers: { 'stripe-signature': GOOD_SIGNATURE },
      body: '{"raw":true}',
    }),
  );
};

/** A team with an admin, an adult player, a minor player, and the minor's guardian. */
type Club = { teamId: string; admin: User; adult: User; minor: User; guardian: User };

/** Seeds {@link Club} with payments enabled. */
const seedClub = (): Club => {
  const admin = makeUser('adult', 'Admin Ada');
  const adult = makeUser('adult', 'Adult Al');
  const minor = makeUser('minor', 'Minor Mo');
  const guardian = makeUser('adult', 'Guardian Gail');
  linkGuardian(guardian, minor);
  const teamId = seedTeam([
    { user: admin, role: 'team_admin' },
    { user: adult, role: 'player' },
    { user: minor, role: 'player' },
  ]);
  enablePayments(teamId);
  return { teamId, admin, adult, minor, guardian };
};

/** Creates a $45 charge for the adult and the minor, due `dueDate`. */
const createCharge = async (club: Club, dueDate = '2030-03-10'): Promise<string> => {
  const created = await call(
    httpEvent('POST', `/payments/teams/${club.teamId}/charges`, {
      headers: { authorization: club.admin.authorization },
      body: { title: 'Spring dues', amountCents: 4500, dueDate, memberIds: [club.adult.userId, club.minor.userId] },
    }),
  );
  expect(created.statusCode).toBe(201);
  return bodyOf(created).chargeId as string;
};

beforeEach(() => {
  clear();
  enqueued.length = 0;
  nextEvent = undefined;
  vi.clearAllMocks();
  setPaymentGateway(fakeGateway);
});

afterEach(() => {
  setPaymentGateway(undefined);
});

describe('payments account', () => {
  it('lets only payment managers start onboarding, and creates the account once', async () => {
    const admin = makeUser('adult', 'Admin');
    const player = makeUser('adult', 'Player');
    const teamId = seedTeam([
      { user: admin, role: 'team_admin' },
      { user: player, role: 'player' },
    ]);

    const before = await call(httpEvent('GET', `/payments/teams/${teamId}/account`, { headers: { authorization: player.authorization } }));
    expect(bodyOf(before)).toEqual({ teamId, connected: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });

    const denied = await call(httpEvent('POST', `/payments/teams/${teamId}/account/link`, { headers: { authorization: player.authorization } }));
    expect(denied.statusCode).toBe(403);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const link = await call(
        httpEvent('POST', `/payments/teams/${teamId}/account/link`, {
          headers: { authorization: admin.authorization },
          body: { returnTo: 'web' },
        }),
      );
      expect(link.statusCode).toBe(200);
      expect(bodyOf(link).url).toBe('https://connect.stripe.test/onboard');
    }
    expect(fakeGateway.createAccount).toHaveBeenCalledTimes(1);
    expect(fakeGateway.createAccountLink).toHaveBeenLastCalledWith({
      accountId: ACCOUNT_ID,
      refreshUrl: `http://localhost:4200/api/payments/return?to=web&result=refresh&teamId=${teamId}`,
      returnUrl: `http://localhost:4200/api/payments/return?to=web&result=onboarded&teamId=${teamId}`,
    });

    fakeGateway.getAccount.mockResolvedValueOnce({ chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true });
    const after = await call(httpEvent('GET', `/payments/teams/${teamId}/account`, { headers: { authorization: player.authorization } }));
    expect(bodyOf(after)).toMatchObject({ connected: true, chargesEnabled: true });
  });
});

describe('charges', () => {
  it('refuses to charge before Stripe is ready, or to charge someone off the roster', async () => {
    const admin = makeUser('adult', 'Admin');
    const teamId = seedTeam([{ user: admin, role: 'team_admin' }]);
    const body = { title: 'Dues', amountCents: 2000, dueDate: '2030-01-01', memberIds: [admin.userId] };

    const notReady = await call(httpEvent('POST', `/payments/teams/${teamId}/charges`, { headers: { authorization: admin.authorization }, body }));
    expect(notReady.statusCode).toBe(409);
    expect(bodyOf(notReady)).toEqual({ error: 'payments_not_enabled' });

    enablePayments(teamId);
    const stranger = await call(
      httpEvent('POST', `/payments/teams/${teamId}/charges`, {
        headers: { authorization: admin.authorization },
        body: { ...body, memberIds: [randomUUID()] },
      }),
    );
    expect(stranger.statusCode).toBe(400);
    expect(bodyOf(stranger)).toEqual({ error: 'member_not_on_team' });

    const tooSmall = await call(
      httpEvent('POST', `/payments/teams/${teamId}/charges`, {
        headers: { authorization: admin.authorization },
        body: { ...body, amountCents: 50 },
      }),
    );
    expect(tooSmall.statusCode).toBe(400);
  });

  it('lists charges with totals and names each member due', async () => {
    const club = seedClub();
    const chargeId = await createCharge(club);

    const list = await call(httpEvent('GET', `/payments/teams/${club.teamId}/charges`, { headers: { authorization: club.admin.authorization } }));
    expect(bodyOf(list).charges).toEqual([
      expect.objectContaining({
        chargeId,
        currency: 'usd',
        totals: { members: 2, settled: 0, outstanding: 2, collectedCents: 0 },
      }),
    ]);

    const playerView = await call(httpEvent('GET', `/payments/teams/${club.teamId}/charges`, { headers: { authorization: club.adult.authorization } }));
    expect(playerView.statusCode).toBe(403);

    const detail = await call(httpEvent('GET', `/payments/teams/${club.teamId}/charges/${chargeId}`, { headers: { authorization: club.admin.authorization } }));
    expect((bodyOf(detail).dues as { memberName: string; status: string }[]).map((due) => [due.memberName, due.status])).toEqual([
      ['Adult Al', 'unpaid'],
      ['Minor Mo', 'unpaid'],
    ]);
  });

  it('lets staff record an offline payment but not undo a Stripe payment', async () => {
    const club = seedClub();
    const chargeId = await createCharge(club);
    const path = (memberId: string) => `/payments/teams/${club.teamId}/charges/${chargeId}/dues/${memberId}`;

    const offline = await call(httpEvent('PATCH', path(club.adult.userId), { headers: { authorization: club.admin.authorization }, body: { status: 'paid_offline' } }));
    expect(offline.statusCode).toBe(200);
    expect(bodyOf(offline)).toMatchObject({ status: 'paid_offline', paidBy: club.admin.userId });

    const due = get(teamPk(club.teamId), dueSk(chargeId, club.minor.userId)) as Record<string, unknown>;
    put({ ...due, status: 'paid' });
    const undo = await call(httpEvent('PATCH', path(club.minor.userId), { headers: { authorization: club.admin.authorization }, body: { status: 'unpaid' } }));
    expect(undo.statusCode).toBe(409);
    expect(bodyOf(undo)).toEqual({ error: 'paid_in_app' });
  });
});

describe('paying dues', () => {
  it("shows each person what they owe and whether they can pay it", async () => {
    const club = seedClub();
    await createCharge(club);
    const duesFor = async (user: User) =>
      (bodyOf(await call(httpEvent('GET', '/payments/me/dues', { headers: { authorization: user.authorization } }))).dues as {
        memberName: string;
        canPay: boolean;
        teamName: string;
      }[]).map((due) => [due.memberName, due.canPay, due.teamName]);

    expect(await duesFor(club.adult)).toEqual([['Adult Al', true, 'Hawks']]);
    expect(await duesFor(club.minor)).toEqual([['Minor Mo', false, 'Hawks']]);
    expect(await duesFor(club.guardian)).toEqual([['Minor Mo', true, 'Hawks']]);
  });

  it("sends a minor's checkout to the guardian and reuses an open session", async () => {
    const club = seedClub();
    const chargeId = await createCharge(club);
    const checkout = (user: User) =>
      call(
        httpEvent('POST', `/payments/teams/${club.teamId}/charges/${chargeId}/dues/${club.minor.userId}/checkout`, {
          headers: { authorization: user.authorization },
          body: { returnTo: 'app' },
        }),
      );

    expect((await checkout(club.minor)).statusCode).toBe(403);
    expect((await checkout(club.adult)).statusCode).toBe(403);

    const first = await checkout(club.guardian);
    expect(first.statusCode).toBe(200);
    expect(bodyOf(first).url).toBe('https://checkout.stripe.test/pay');
    expect(fakeGateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        amountCents: 4500,
        feeCents: 90,
        metadata: { teamId: club.teamId, chargeId, memberId: club.minor.userId, payerId: club.guardian.userId },
        successUrl: 'http://localhost:4200/api/payments/return?to=app&result=success',
      }),
    );
    expect(get(teamPk(club.teamId), dueSk(chargeId, club.minor.userId))).toMatchObject({ status: 'pending' });

    await checkout(club.guardian);
    expect(fakeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(fakeGateway.getCheckoutSession).toHaveBeenCalledTimes(1);
  });
});

describe('stripe webhook', () => {
  it('rejects a bad signature', async () => {
    const result = await call(httpEvent('POST', '/payments/webhook', { headers: { 'stripe-signature': 'nope' }, body: '{}' }));
    expect(result.statusCode).toBe(400);
    expect(bodyOf(result)).toEqual({ error: 'invalid_signature' });
  });

  it('marks a due paid once, tells the charge creator, and ignores other accounts', async () => {
    const club = seedClub();
    const chargeId = await createCharge(club);
    const session = {
      id: 'cs_paid',
      payment_status: 'paid',
      payment_intent: 'pi_1',
      metadata: { teamId: club.teamId, chargeId, memberId: club.adult.userId, payerId: club.adult.userId },
    };

    const spoofed = await deliverWebhook({ type: 'checkout.session.completed', account: 'acct_other', object: session });
    expect(spoofed.statusCode).toBe(200);
    expect(get(teamPk(club.teamId), dueSk(chargeId, club.adult.userId))).toMatchObject({ status: 'unpaid' });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const delivered = await deliverWebhook({ type: 'checkout.session.completed', account: ACCOUNT_ID, object: session });
      expect(delivered.statusCode).toBe(200);
    }
    expect(get(teamPk(club.teamId), dueSk(chargeId, club.adult.userId))).toMatchObject({
      status: 'paid',
      paidBy: club.adult.userId,
      checkoutSessionId: 'cs_paid',
      paymentIntentId: 'pi_1',
    });
    expect(enqueued).toEqual([
      expect.objectContaining({ type: 'payment_received', memberDisplayName: 'Adult Al', userIds: [club.admin.userId] }),
    ]);

    fakeGateway.paymentIntentMetadata.mockResolvedValueOnce(session.metadata);
    await deliverWebhook({ type: 'charge.refunded', account: ACCOUNT_ID, object: { refunded: true, payment_intent: 'pi_1' } });
    expect(get(teamPk(club.teamId), dueSk(chargeId, club.adult.userId))).toMatchObject({ status: 'refunded' });
  });

  it('frees a due when its checkout expires, and records account changes', async () => {
    const club = seedClub();
    const chargeId = await createCharge(club);
    const due = get(teamPk(club.teamId), dueSk(chargeId, club.adult.userId)) as Record<string, unknown>;
    put({ ...due, status: 'pending', checkoutSessionId: 'cs_open' });

    await deliverWebhook({
      type: 'checkout.session.expired',
      account: ACCOUNT_ID,
      object: { id: 'cs_open', metadata: { teamId: club.teamId, chargeId, memberId: club.adult.userId } },
    });
    expect(get(teamPk(club.teamId), dueSk(chargeId, club.adult.userId))).toMatchObject({ status: 'unpaid' });
    expect(get(teamPk(club.teamId), dueSk(chargeId, club.adult.userId))?.checkoutSessionId).toBeUndefined();

    await deliverWebhook({ type: 'account.updated', object: { id: ACCOUNT_ID, charges_enabled: false, payouts_enabled: false } });
    expect(get(teamPk(club.teamId), teamStripeSk())).toMatchObject({ chargesEnabled: false });
  });
});

describe('dues reminders', () => {
  it('reminds adults and guardians of unpaid dues on the due date, then drops the row', async () => {
    const club = seedClub();
    const chargeId = await createCharge(club, '2030-03-10');
    const offline = `/payments/teams/${club.teamId}/charges/${chargeId}/dues/${club.adult.userId}`;

    expect(await runDuePaymentReminders(new Date('2030-03-06T15:00:00Z'))).toBe(0);
    expect(await runDuePaymentReminders(new Date('2030-03-07T15:00:00Z'))).toBe(1);
    expect(enqueued).toEqual([
      expect.objectContaining({
        type: 'dues_reminder',
        kind: 'upcoming',
        userIds: expect.arrayContaining([club.adult.userId, club.guardian.userId]),
      }),
    ]);
    expect((enqueued[0] as { userIds: string[] }).userIds).not.toContain(club.minor.userId);

    await call(httpEvent('PATCH', offline, { headers: { authorization: club.admin.authorization }, body: { status: 'waived' } }));
    enqueued.length = 0;
    expect(await runDuePaymentReminders(new Date('2030-03-10T15:00:00Z'))).toBe(1);
    expect(enqueued).toEqual([expect.objectContaining({ kind: 'due', userIds: [club.guardian.userId] })]);

    const remaining = [...store.keys()].filter((key) => key.startsWith(`${PAYMENT_REMINDERS_PK}\0${PAYMENT_REMINDER_SK_PREFIX}`));
    expect(remaining).toHaveLength(4);
    expect(store.has(itemKey(PAYMENT_REMINDERS_PK, `${PAYMENT_REMINDER_SK_PREFIX}2030-03-10#${club.teamId}#${chargeId}#due`))).toBe(false);
  });

  it('schedules three days before, the due date, then four weekly nudges, skipping the past', () => {
    expect(reminderSchedule('2030-03-10', '2030-01-01').map((entry) => `${entry.sendOn}:${entry.kind}`)).toEqual([
      '2030-03-07:upcoming',
      '2030-03-10:due',
      '2030-03-17:overdue',
      '2030-03-24:overdue',
      '2030-03-31:overdue',
      '2030-04-07:overdue',
    ]);
    expect(reminderSchedule('2030-03-10', '2030-03-20')).toHaveLength(3);
  });
});

describe('returning from Stripe', () => {
  it('redirects to the app deep link or the matching website page', async () => {
    const app = await call(httpEvent('GET', '/payments/return', { query: { to: 'app', result: 'success' } }));
    expect(app.statusCode).toBe(302);
    expect(app.headers?.location).toBe('gameplan://payments?result=success');

    const web = await call(httpEvent('GET', '/payments/return', { query: { to: 'web', result: 'onboarded', teamId: 'team-1' } }));
    expect(web.headers?.location).toBe('http://localhost:4200/teams/team-1/payments?result=onboarded&teamId=team-1');

    const evil = await call(httpEvent('GET', '/payments/return', { query: { to: 'https://evil.test', result: 'success' } }));
    expect(evil.statusCode).toBe(400);
  });

  it('takes a 2% platform fee by default', () => {
    expect(platformFeeCents(4500)).toBe(90);
    expect(platformFeeCents(125)).toBe(3);
  });
});
