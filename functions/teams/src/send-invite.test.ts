/**
 * `POST /teams/:teamId/invites/send` with an in-memory table and a fake
 * SES/SMS delivery.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountKind } from '@gameplan/types';
import type { UserProfileItem } from '../../lib/auth/identity-provider.js';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import type { InviteDelivery } from './invite-delivery.js';

const { store } = memoryTable;
const profiles = new Map<string, UserProfileItem>();

const delivery = vi.hoisted(() => ({
  configured: vi.fn<InviteDelivery['configured']>(),
  email: vi.fn<InviteDelivery['email']>(),
  text: vi.fn<InviteDelivery['text']>(),
}));

vi.mock('./invite-delivery.js', () => ({ awsInviteDelivery: delivery }));

vi.mock('../../lib/auth/profile.js', () => ({
  getProfile: async (userId: string) => profiles.get(userId),
  putProfile: async () => {
    throw new Error('not_used');
  },
}));

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

const { handler } = await import('./handler.js');
const { SENDER_DAILY_INVITE_SENDS } = await import('./team-store.js');

const httpEvent = (
  method: string,
  path: string,
  options: { body?: unknown; authorization?: string } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.authorization === undefined ? {} : { authorization: options.authorization },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

const seedUser = (accountKind: AccountKind, displayName: string) => {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  profiles.set(userId, {
    PK: `USER#${userId}`,
    SK: 'PROFILE',
    userId,
    email,
    displayName,
    accountKind,
    createdAt: new Date().toISOString(),
  });
  const { accessToken } = issueLocalTokens(userId, email);
  return { authorization: `Bearer ${accessToken}`, userId, email };
};

const bodyOf = (result: { body?: string }): Record<string, unknown> =>
  JSON.parse(result.body ?? '{}') as Record<string, unknown>;

const createTeam = async (authorization: string): Promise<string> => {
  const created = await handler(
    httpEvent('POST', '/teams', { authorization, body: { name: 'Rockets', timeZone: 'America/New_York' } }),
  );
  return bodyOf(created).teamId as string;
};

const send = (teamId: string, authorization: string, body: Record<string, unknown>) =>
  handler(httpEvent('POST', `/teams/${teamId}/invites/send`, { authorization, body }));

describe('sending invites from GamePlan', () => {
  beforeEach(() => {
    store.clear();
    profiles.clear();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
    process.env.LOCAL_JWT_SECRET = 'send-invite-test-secret';
    process.env.CLIENT_ORIGIN = 'https://staging.example.com';
    delivery.configured.mockReset().mockReturnValue(true);
    delivery.email.mockReset().mockResolvedValue(undefined);
    delivery.text.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    store.clear();
    profiles.clear();
  });

  it('emails the role code with the inviter as reply-to', async () => {
    const admin = seedUser('adult', 'Coach Sam');
    const teamId = await createTeam(admin.authorization);

    const sent = await send(teamId, admin.authorization, {
      channel: 'email',
      to: ' Parent@Example.com ',
      role: 'parent',
    });

    expect(sent.statusCode).toBe(200);
    const { code } = bodyOf(sent);
    expect(bodyOf(sent)).toMatchObject({ channel: 'email', role: 'parent' });
    expect(delivery.email).toHaveBeenCalledTimes(1);
    const email = delivery.email.mock.calls[0]![0];
    expect(email).toMatchObject({
      to: 'parent@example.com',
      inviterName: 'Coach Sam',
      replyTo: admin.email,
      subject: 'Coach Sam invited you to join Rockets on GamePlan',
    });
    expect(email.text).toContain(`https://staging.example.com/invite/${String(code)}`);
    expect(email.text).toContain('Parent');

    const listed = await handler(httpEvent('GET', `/teams/${teamId}/invites`, { authorization: admin.authorization }));
    expect(bodyOf(listed).invites).toEqual([expect.objectContaining({ role: 'parent', code })]);
  });

  it('texts a US number in Spanish with the opt-out line', async () => {
    const admin = seedUser('adult', 'Coach Sam');
    const teamId = await createTeam(admin.authorization);

    const sent = await send(teamId, admin.authorization, { channel: 'text', to: '(415) 555-0134', locale: 'es' });

    expect(sent.statusCode).toBe(200);
    expect(delivery.text).toHaveBeenCalledWith({
      to: '+14155550134',
      body: expect.stringMatching(/^GamePlan: Coach Sam te invitó a unirte a Rockets como Jugador\..*STOP/u),
    });
  });

  it('refuses numbers outside the US and Canada', async () => {
    const admin = seedUser('adult', 'Coach Sam');
    const teamId = await createTeam(admin.authorization);

    const sent = await send(teamId, admin.authorization, { channel: 'text', to: '+44 20 7946 0958' });

    expect(sent.statusCode).toBe(400);
    expect(bodyOf(sent).error).toBe('text_country_unsupported');
    expect(delivery.text).not.toHaveBeenCalled();
  });

  it('refuses an address list', async () => {
    const admin = seedUser('adult', 'Coach Sam');
    const teamId = await createTeam(admin.authorization);

    const sent = await send(teamId, admin.authorization, { channel: 'email', to: 'a@example.com,b@example.com' });

    expect(sent.statusCode).toBe(400);
    expect(bodyOf(sent).error).toBe('invalid_recipient');
  });

  it('reports an unconfigured channel without spending the limit', async () => {
    const admin = seedUser('adult', 'Coach Sam');
    const teamId = await createTeam(admin.authorization);
    delivery.configured.mockReturnValue(false);

    const sent = await send(teamId, admin.authorization, { channel: 'text', to: '4155550134' });

    expect(sent.statusCode).toBe(503);
    expect(bodyOf(sent).error).toBe('text_not_configured');
    expect([...store.keys()].some((key) => key.includes('SENT_INVITES#'))).toBe(false);
  });

  it('stops a sender at the daily limit', async () => {
    const admin = seedUser('adult', 'Coach Sam');
    const teamId = await createTeam(admin.authorization);
    for (let index = 0; index < SENDER_DAILY_INVITE_SENDS; index += 1) {
      expect((await send(teamId, admin.authorization, { channel: 'email', to: `p${index}@example.com` })).statusCode).toBe(200);
    }

    const over = await send(teamId, admin.authorization, { channel: 'email', to: 'one-more@example.com' });

    expect(over.statusCode).toBe(429);
    expect(bodyOf(over).error).toBe('invite_send_limit');
    expect(delivery.email).toHaveBeenCalledTimes(SENDER_DAILY_INVITE_SENDS);
  });

  it('needs the invite permission', async () => {
    const admin = seedUser('adult', 'Coach Sam');
    const player = seedUser('adult', 'Player Pat');
    const teamId = await createTeam(admin.authorization);
    const invite = await handler(
      httpEvent('POST', `/teams/${teamId}/invites`, { authorization: admin.authorization, body: { role: 'player' } }),
    );
    await handler(
      httpEvent('POST', `/teams/invite/${String(bodyOf(invite).code)}/accept`, { authorization: player.authorization }),
    );

    const sent = await send(teamId, player.authorization, { channel: 'email', to: 'friend@example.com' });

    expect(sent.statusCode).toBe(403);
    expect(delivery.email).not.toHaveBeenCalled();
  });

  it('maps an opted-out number to a conflict', async () => {
    const admin = seedUser('adult', 'Coach Sam');
    const teamId = await createTeam(admin.authorization);
    delivery.text.mockRejectedValue(new Error('recipient_opted_out'));

    const sent = await send(teamId, admin.authorization, { channel: 'text', to: '4155550134' });

    expect(sent.statusCode).toBe(409);
    expect(bodyOf(sent).error).toBe('recipient_opted_out');
  });
});
