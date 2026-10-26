/**
 * Team waivers: the plan gate, who writes and who signs, versions, the staff
 * missing list, paper forms, and organization templates.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canSignWaiver, mustSignWaiver, waiverMemberStatus } from '@gameplan/rules';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import {
  TABLE_PK,
  TABLE_SK,
  childSk,
  guardianSk,
  orgAdminSk,
  orgMetaSk,
  orgPk,
  planSk,
  profileSk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamOrgSk,
  teamPk,
  userPk,
  userTeamSk,
} from '../../lib/dynamo/keys.js';

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

const { sent } = vi.hoisted(() => ({ sent: [] as { type: string; kind?: string; userIds?: string[] }[] }));
vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (job: { type: string; kind?: string; userIds?: string[] }): Promise<void> => {
    sent.push(job);
  },
}));

const { handler: teams } = await import('./handler.js');
const { handler: orgs } = await import('../../orgs/src/handler.js');
const { runDueWaiverReminders } = await import('./waiver-reminders.js');
const { renderPdf, toWinAnsi, wrapParagraph } = await import('../../lib/pdf.js');

type Caller = { userId: string; token: string };
type Handler = (event: APIGatewayProxyEventV2) => ReturnType<typeof orgs>;

const call = (target: Handler, caller: Caller, method: string, path: string, body?: unknown) =>
  target({
    version: '2.0',
    rawPath: path,
    headers: { authorization: `Bearer ${caller.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { http: { method, path } },
  } as unknown as APIGatewayProxyEventV2);

const body = <T>(result: { body?: string }): T => JSON.parse(result.body ?? '') as T;

/** A signed-in person with a profile. */
const person = (accountKind: 'adult' | 'minor', displayName: string): Caller => {
  const userId = randomUUID();
  memoryTable.put({
    [TABLE_PK]: userPk(userId),
    [TABLE_SK]: profileSk(),
    userId,
    email: `${userId}@example.com`,
    displayName,
    accountKind,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  return { userId, token: issueLocalTokens(userId, `${userId}@example.com`).accessToken };
};

/** Puts someone on a team. */
const join = (teamId: string, caller: Caller, roles: string[], displayName = 'Member'): Caller => {
  memoryTable.put({
    [TABLE_PK]: teamPk(teamId),
    [TABLE_SK]: teamMemberSk(caller.userId),
    teamId,
    userId: caller.userId,
    role: roles[0],
    roles,
    displayName,
  });
  memoryTable.put({ [TABLE_PK]: userPk(caller.userId), [TABLE_SK]: userTeamSk(teamId), teamId, role: roles[0], roles });
  return caller;
};

/** Links a guardian to a minor. */
const link = (adult: Caller, minor: Caller): void => {
  memoryTable.put({ [TABLE_PK]: userPk(minor.userId), [TABLE_SK]: guardianSk(adult.userId), minorId: minor.userId, adultId: adult.userId });
  memoryTable.put({ [TABLE_PK]: userPk(adult.userId), [TABLE_SK]: childSk(minor.userId), minorId: minor.userId, adultId: adult.userId });
};

const premium = (teamId: string): void => {
  memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: planSk(), teamId, tier: 'premium', status: 'active' });
};

const RELEASE = { title: 'Season release', body: 'I accept the risks of playing.' };

type WaiverWire = { waiverId: string; version: number; totals: { members: number; signed: number; missing: number } };

describe('waiver rules', () => {
  it('lets the people who pay dues sign', () => {
    expect(canSignWaiver('a', { userId: 'a', accountKind: 'adult' })).toBe(true);
    expect(canSignWaiver('m', { userId: 'm', accountKind: 'minor', guardianIds: ['g'] })).toBe(false);
    expect(canSignWaiver('g', { userId: 'm', accountKind: 'minor', guardianIds: ['g'] })).toBe(true);
  });

  it('asks members holding an audience role and tracks versions', () => {
    expect(mustSignWaiver(['coach', 'player'], ['player'])).toBe(true);
    expect(mustSignWaiver(['parent'], ['player'])).toBe(false);
    expect(waiverMemberStatus(2, undefined)).toBe('missing');
    expect(waiverMemberStatus(2, 1)).toBe('outdated');
    expect(waiverMemberStatus(2, 2)).toBe('signed');
  });
});

describe('team waivers', () => {
  let teamId: string;
  let admin: Caller;

  beforeEach(() => {
    memoryTable.clear();
    teamId = randomUUID();
    memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMetaSk(), teamId, name: 'Hawks' });
    admin = join(teamId, person('adult', 'Ada Admin'), ['team_admin'], 'Ada Admin');
  });

  it('needs a plan with waivers and the manage_waivers permission to write one', async () => {
    const coach = join(teamId, person('adult', 'Cole Coach'), ['coach']);
    expect((await call(teams, admin, 'POST', `/teams/${teamId}/waivers`, RELEASE)).statusCode).toBe(402);

    premium(teamId);
    expect((await call(teams, coach, 'POST', `/teams/${teamId}/waivers`, RELEASE)).statusCode).toBe(403);
    const created = await call(teams, admin, 'POST', `/teams/${teamId}/waivers`, RELEASE);
    expect(created.statusCode).toBe(201);
    expect(body<{ audience: string[]; version: number }>(created)).toMatchObject({ audience: ['player'], version: 1 });

    memoryTable.put({
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: rolePermissionsSk('coach'),
      role: 'coach',
      permissions: ['manage_waivers'],
    });
    expect((await call(teams, coach, 'POST', `/teams/${teamId}/waivers`, RELEASE)).statusCode).toBe(201);
  });

  it('lets an adult sign their own and a guardian sign a minor, never the minor', async () => {
    premium(teamId);
    const adultPlayer = join(teamId, person('adult', 'Pat Player'), ['player']);
    const minor = join(teamId, person('minor', 'Kid Player'), ['player']);
    const parent = person('adult', 'Gina Guardian');
    link(parent, minor);
    const stranger = person('adult', 'Sam Stranger');
    const { waiverId } = body<WaiverWire>(await call(teams, admin, 'POST', `/teams/${teamId}/waivers`, RELEASE));
    const sign = (caller: Caller, memberId: string, signerName: string, version = 1) =>
      call(teams, caller, 'POST', `/teams/${teamId}/waivers/${waiverId}/signatures/${memberId}`, {
        version,
        signerName,
        agree: true,
      });

    expect((await sign(minor, minor.userId, 'Kid Player')).statusCode).toBe(403);
    expect((await sign(stranger, minor.userId, 'Sam Stranger')).statusCode).toBe(403);
    expect((await sign(adultPlayer, adultPlayer.userId, 'Pat Player', 2)).statusCode).toBe(409);
    expect((await sign(admin, admin.userId, 'Ada Admin')).statusCode).toBe(400);

    const own = await sign(adultPlayer, adultPlayer.userId, 'Pat Player');
    expect(own.statusCode).toBe(201);
    expect(body<{ relationship: string; method: string; textHash: string }>(own)).toMatchObject({
      relationship: 'self',
      method: 'electronic',
    });
    expect((await sign(adultPlayer, adultPlayer.userId, 'Pat Player')).statusCode).toBe(409);

    const forChild = await sign(parent, minor.userId, 'Gina Guardian');
    expect(forChild.statusCode).toBe(201);
    expect(body<{ relationship: string; signedBy: string }>(forChild)).toMatchObject({
      relationship: 'guardian',
      signedBy: parent.userId,
    });

    const record = await call(teams, minor, 'GET', `/teams/${teamId}/waivers/${waiverId}/signatures/${minor.userId}`);
    expect(record.statusCode).toBe(200);
    expect(body<{ body: string }>(record).body).toBe(RELEASE.body);
    expect(
      (await call(teams, stranger, 'GET', `/teams/${teamId}/waivers/${waiverId}/signatures/${minor.userId}`)).statusCode,
    ).toBe(403);
    expect(
      (await call(teams, admin, 'GET', `/teams/${teamId}/waivers/${waiverId}/signatures/${minor.userId}`)).statusCode,
    ).toBe(200);
  });

  it('asks everyone again after the text changes, and keeps what they signed', async () => {
    premium(teamId);
    const player = join(teamId, person('adult', 'Pat Player'), ['player']);
    const { waiverId } = body<WaiverWire>(await call(teams, admin, 'POST', `/teams/${teamId}/waivers`, RELEASE));
    await call(teams, player, 'POST', `/teams/${teamId}/waivers/${waiverId}/signatures/${player.userId}`, {
      version: 1,
      signerName: 'Pat Player',
      agree: true,
    });

    const dueOnly = await call(teams, admin, 'PATCH', `/teams/${teamId}/waivers/${waiverId}`, { dueDate: '2026-12-01' });
    expect(body<WaiverWire>(dueOnly)).toMatchObject({ version: 1, totals: { signed: 1, missing: 0 } });

    const edited = await call(teams, admin, 'PATCH', `/teams/${teamId}/waivers/${waiverId}`, {
      body: 'I accept the risks of playing and travel.',
    });
    expect(body<WaiverWire>(edited)).toMatchObject({ version: 2, totals: { members: 1, signed: 0, missing: 1 } });

    const detail = body<{ members: { memberId: string; status: string; signedVersion?: number }[] }>(
      await call(teams, admin, 'GET', `/teams/${teamId}/waivers/${waiverId}`),
    );
    expect(detail.members).toEqual([expect.objectContaining({ memberId: player.userId, status: 'outdated', signedVersion: 1 })]);

    const record = body<{ version: number; body: string }>(
      await call(teams, player, 'GET', `/teams/${teamId}/waivers/${waiverId}/signatures/${player.userId}`),
    );
    expect(record).toMatchObject({ version: 1, body: RELEASE.body });

    const mine = body<{ waivers: { status: string; canSign: boolean; version: number }[] }>(
      await call(teams, player, 'GET', '/teams/me/waivers'),
    );
    expect(mine.waivers).toEqual([expect.objectContaining({ status: 'outdated', canSign: true, version: 2 })]);
  });

  it('shows staff who cannot sign in the app and lets them record paper', async () => {
    premium(teamId);
    const minor = join(teamId, person('minor', 'Kid Player'), ['player'], 'Kid Player');
    const { waiverId } = body<WaiverWire>(await call(teams, admin, 'POST', `/teams/${teamId}/waivers`, RELEASE));

    const before = body<{ members: { canSignInApp: boolean; status: string }[] }>(
      await call(teams, admin, 'GET', `/teams/${teamId}/waivers/${waiverId}`),
    );
    expect(before.members).toEqual([expect.objectContaining({ canSignInApp: false, status: 'missing' })]);

    const paperPath = `/teams/${teamId}/waivers/${waiverId}/signatures/${minor.userId}/paper`;
    const paper = await call(teams, admin, 'PUT', paperPath, { signerName: 'Paula Parent' });
    expect(paper.statusCode).toBe(201);
    expect(body<{ method: string; relationship: string }>(paper)).toMatchObject({ method: 'paper', relationship: 'staff' });
    expect((await call(teams, admin, 'DELETE', paperPath)).statusCode).toBe(204);
    expect((await call(teams, admin, 'DELETE', paperPath)).statusCode).toBe(404);

    const adult = join(teamId, person('adult', 'Pat Player'), ['player']);
    await call(teams, adult, 'POST', `/teams/${teamId}/waivers/${waiverId}/signatures/${adult.userId}`, {
      version: 1,
      signerName: 'Pat Player',
      agree: true,
    });
    const undoElectronic = await call(
      teams,
      admin,
      'DELETE',
      `/teams/${teamId}/waivers/${waiverId}/signatures/${adult.userId}/paper`,
    );
    expect(undoElectronic.statusCode).toBe(409);
  });

  it("lists a child's waivers for a guardian who is not on the team, and hides archived ones", async () => {
    premium(teamId);
    const minor = join(teamId, person('minor', 'Kid Player'), ['player']);
    const parent = person('adult', 'Gina Guardian');
    link(parent, minor);
    const { waiverId } = body<WaiverWire>(
      await call(teams, admin, 'POST', `/teams/${teamId}/waivers`, { ...RELEASE, dueDate: '2026-11-01' }),
    );

    const forParent = body<{ waivers: { memberId: string; teamName: string; canSign: boolean }[] }>(
      await call(teams, parent, 'GET', '/teams/me/waivers'),
    );
    expect(forParent.waivers).toEqual([
      expect.objectContaining({ memberId: minor.userId, teamName: 'Hawks', canSign: true }),
    ]);
    const forMinor = body<{ waivers: { canSign: boolean }[] }>(await call(teams, minor, 'GET', '/teams/me/waivers'));
    expect(forMinor.waivers).toEqual([expect.objectContaining({ canSign: false })]);

    await call(teams, admin, 'PATCH', `/teams/${teamId}/waivers/${waiverId}`, { archived: true });
    expect(body<{ waivers: unknown[] }>(await call(teams, parent, 'GET', '/teams/me/waivers')).waivers).toEqual([]);
    const signArchived = await call(teams, parent, 'POST', `/teams/${teamId}/waivers/${waiverId}/signatures/${minor.userId}`, {
      version: 1,
      signerName: 'Gina Guardian',
      agree: true,
    });
    expect(signArchived.statusCode).toBe(409);
  });
});

describe('organization waiver templates', () => {
  it('lets a member team copy a template, and later template edits leave the copy alone', async () => {
    memoryTable.clear();
    const orgId = randomUUID();
    const teamId = randomUUID();
    const owner = person('adult', 'Olga Owner');
    memoryTable.put({ [TABLE_PK]: orgPk(orgId), [TABLE_SK]: orgMetaSk(), orgId, name: 'Club', ownerId: owner.userId, createdAt: '2026-01-01' });
    memoryTable.put({ [TABLE_PK]: orgPk(orgId), [TABLE_SK]: orgAdminSk(owner.userId), orgId, userId: owner.userId });
    memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMetaSk(), teamId, name: 'U12' });
    memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamOrgSk(), teamId, orgId });
    const admin = join(teamId, person('adult', 'Ada Admin'), ['team_admin']);

    const refused = await call(orgs, owner, 'POST', `/orgs/${orgId}/waiver-templates`, RELEASE);
    expect(refused.statusCode).toBe(402);
    memoryTable.put({ [TABLE_PK]: orgPk(orgId), [TABLE_SK]: planSk(), orgId, tier: 'organization', status: 'active' });
    memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: planSk(), teamId, tier: 'organization', status: 'active', orgId });
    expect((await call(orgs, admin, 'POST', `/orgs/${orgId}/waiver-templates`, RELEASE)).statusCode).toBe(403);

    const template = body<{ templateId: string }>(await call(orgs, owner, 'POST', `/orgs/${orgId}/waiver-templates`, RELEASE));
    const offered = body<{ orgId: string; templates: { templateId: string }[] }>(
      await call(teams, admin, 'GET', `/teams/${teamId}/waiver-templates`),
    );
    expect(offered).toMatchObject({ orgId, templates: [{ templateId: template.templateId }] });

    const copy = await call(teams, admin, 'POST', `/teams/${teamId}/waivers/from-template`, {
      templateId: template.templateId,
      dueDate: '2026-12-01',
    });
    expect(copy.statusCode).toBe(201);
    const copied = body<{ waiverId: string; orgId: string; templateId: string; body: string }>(copy);
    expect(copied).toMatchObject({ orgId, templateId: template.templateId, body: RELEASE.body });

    await call(orgs, owner, 'PATCH', `/orgs/${orgId}/waiver-templates/${template.templateId}`, { body: 'New wording.' });
    const after = body<{ waiver: { body: string } }>(await call(teams, admin, 'GET', `/teams/${teamId}/waivers/${copied.waiverId}`));
    expect(after.waiver.body).toBe(RELEASE.body);

    const outsideTeam = randomUUID();
    memoryTable.put({ [TABLE_PK]: teamPk(outsideTeam), [TABLE_SK]: teamMetaSk(), teamId: outsideTeam, name: 'Solo' });
    premium(outsideTeam);
    const outsider = join(outsideTeam, person('adult', 'Out Admin'), ['team_admin']);
    const stolen = await call(teams, outsider, 'POST', `/teams/${outsideTeam}/waivers/from-template`, {
      templateId: template.templateId,
    });
    expect(stolen.statusCode).toBe(404);
  });
});

describe('waiver reminders', () => {
  it('reminds whoever still has to sign, and drops rows for a moved due date', async () => {
    memoryTable.clear();
    sent.length = 0;
    const teamId = randomUUID();
    memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMetaSk(), teamId, name: 'Hawks' });
    premium(teamId);
    const admin = join(teamId, person('adult', 'Ada Admin'), ['team_admin']);
    const signer = join(teamId, person('adult', 'Pat Player'), ['player']);
    const minor = join(teamId, person('minor', 'Kid Player'), ['player']);
    const parent = person('adult', 'Gina Guardian');
    link(parent, minor);
    join(teamId, person('minor', 'No Guardian'), ['player']);

    const dueDate = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const { waiverId } = body<WaiverWire>(await call(teams, admin, 'POST', `/teams/${teamId}/waivers`, { ...RELEASE, dueDate }));
    await call(teams, signer, 'POST', `/teams/${teamId}/waivers/${waiverId}/signatures/${signer.userId}`, {
      version: 1,
      signerName: 'Pat Player',
      agree: true,
    });

    const threeBefore = new Date(`${dueDate}T15:00:00Z`);
    threeBefore.setUTCDate(threeBefore.getUTCDate() - 3);
    expect(await runDueWaiverReminders(new Date(threeBefore.getTime() - 86_400_000))).toBe(0);
    expect(await runDueWaiverReminders(threeBefore)).toBe(1);
    expect(sent).toEqual([expect.objectContaining({ type: 'waiver_reminder', kind: 'upcoming', userIds: [parent.userId] })]);

    const later = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await call(teams, admin, 'PATCH', `/teams/${teamId}/waivers/${waiverId}`, { dueDate: later });
    sent.length = 0;
    expect(await runDueWaiverReminders(new Date(`${dueDate}T15:00:00Z`))).toBe(1);
    expect(sent).toEqual([]);
  });
});

describe('waiver PDF', () => {
  it('wraps text to the page and encodes accents', () => {
    expect(toWinAnsi('Peña ✓ “ok”')).toBe('Peña ? \x93ok\x94');
    const lines = wrapParagraph('word '.repeat(200).trim(), 11, false);
    expect(lines.length).toBeGreaterThan(5);
    const pdf = renderPdf({ title: 'T', blocks: [{ text: 'x\n'.repeat(200) }] }).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    const count = Number(/\/Count (\d+)/u.exec(pdf)?.[1]);
    expect(count).toBeGreaterThan(3);
    expect(pdf.match(/\/Type \/Page /gu)).toHaveLength(count);
    expect(pdf).toContain(`Page ${count} of ${count}`);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('serves a signed copy through a short-lived link for the member, guardians, and staff only', async () => {
    memoryTable.clear();
    const teamId = randomUUID();
    memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMetaSk(), teamId, name: 'Hawks' });
    premium(teamId);
    const admin = join(teamId, person('adult', 'Ada Admin'), ['team_admin']);
    const minor = join(teamId, person('minor', 'Kid Peña'), ['player']);
    const parent = person('adult', 'Gina Guardian');
    link(parent, minor);
    const stranger = person('adult', 'Sam Stranger');
    const { waiverId } = body<WaiverWire>(await call(teams, admin, 'POST', `/teams/${teamId}/waivers`, RELEASE));
    const linkPath = `/teams/${teamId}/waivers/${waiverId}/signatures/${minor.userId}/pdf-link`;

    expect((await call(teams, parent, 'POST', linkPath)).statusCode).toBe(404);
    await call(teams, parent, 'POST', `/teams/${teamId}/waivers/${waiverId}/signatures/${minor.userId}`, {
      version: 1,
      signerName: 'Gina Guardian',
      agree: true,
    });
    expect((await call(teams, stranger, 'POST', linkPath)).statusCode).toBe(403);
    expect((await call(teams, admin, 'POST', linkPath)).statusCode).toBe(200);
    const issued = await call(teams, parent, 'POST', linkPath);
    const { ticket } = body<{ ticket: string }>(issued);

    const pdf = await teams({
      version: '2.0',
      rawPath: `/teams/waiver-pdf/${ticket}`,
      headers: {},
      isBase64Encoded: false,
      requestContext: { http: { method: 'GET', path: `/teams/waiver-pdf/${ticket}` } },
    } as unknown as APIGatewayProxyEventV2);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers?.['content-type']).toBe('application/pdf');
    expect(pdf.headers?.['content-disposition']).toContain('season-release-kid-pena.pdf');
    const text = Buffer.from(pdf.body ?? '', 'base64').toString('latin1');
    expect(text).toContain('(Season release) Tj');
    expect(text).toContain('Signed by: Gina Guardian');

    const forged = await teams({
      version: '2.0',
      rawPath: `/teams/waiver-pdf/${'a'.repeat(43)}`,
      headers: {},
      isBase64Encoded: false,
      requestContext: { http: { method: 'GET', path: `/teams/waiver-pdf/${'a'.repeat(43)}` } },
    } as unknown as APIGatewayProxyEventV2);
    expect(forged.statusCode).toBe(410);
  });
});
