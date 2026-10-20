/**
 * Who may read and change emergency and medical info, through identity and through a team.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canEditMedicalInfo, canReadOwnMedicalInfo } from '@gameplan/rules';
import { issueLocalTokens } from './auth/local-jwt.js';
import { memoryTable } from './dynamo/memory-table.js';
import {
  MEDICAL_READ_SK_PREFIX,
  TABLE_PK,
  TABLE_SK,
  childSk,
  guardianSk,
  profileSk,
  rolePermissionsSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userPk,
} from './dynamo/keys.js';

vi.mock('./dynamo/access.js', async () => (await import('./dynamo/memory-table.js')).memoryAccess);
vi.mock('./fanout-enqueue.js', () => ({
  enqueueFanout: async (): Promise<void> => undefined,
  resetFanoutSqsClient: (): void => undefined,
}));

const { handler: identity } = await import('../identity/src/handler.js');
const { handler: teams } = await import('../teams/src/handler.js');

type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;

const call = (handle: Handler, method: string, path: string, userId: string, body?: unknown) =>
  handle({
    version: '2.0',
    rawPath: path,
    headers: {
      authorization: `Bearer ${issueLocalTokens(userId, `${userId}@example.com`).accessToken}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, path } },
  } as unknown as APIGatewayProxyEventV2);

const profile = (userId: string, accountKind: 'adult' | 'minor', phoneNumber?: string): void => {
  memoryTable.put({
    [TABLE_PK]: userPk(userId),
    [TABLE_SK]: profileSk(),
    userId,
    email: `${userId}@example.com`,
    displayName: `Name ${userId}`,
    accountKind,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...(phoneNumber !== undefined ? { phoneNumber } : {}),
  });
};

const member = (userId: string, role: string): void => {
  memoryTable.put({ [TABLE_PK]: teamPk('t1'), [TABLE_SK]: teamMemberSk(userId), userId, role });
};

const record = {
  allergies: 'Peanuts',
  emergencyContacts: [{ name: 'Aunt May', phone: '(202) 555-0100', relation: 'Aunt' }],
};

describe('medical rules', () => {
  it('lets adults keep their own and guardians keep a minor’s', () => {
    expect(canEditMedicalInfo('a', { userId: 'a', accountKind: 'adult' })).toBe(true);
    expect(canEditMedicalInfo('b', { userId: 'a', accountKind: 'adult' })).toBe(false);
    expect(canEditMedicalInfo('kid', { userId: 'kid', accountKind: 'minor', guardianIds: ['mom'] })).toBe(false);
    expect(canEditMedicalInfo('mom', { userId: 'kid', accountKind: 'minor', guardianIds: ['mom'] })).toBe(true);
    expect(canReadOwnMedicalInfo('kid', { userId: 'kid', accountKind: 'minor', guardianIds: ['mom'] })).toBe(true);
  });
});

describe('medical routes', () => {
  beforeEach(() => {
    memoryTable.clear();
    profile('mom', 'adult', '+12025550111');
    profile('kid', 'minor');
    profile('coach', 'adult');
    profile('teen-coach', 'minor');
    profile('player', 'adult');
    memoryTable.put({ [TABLE_PK]: userPk('kid'), [TABLE_SK]: guardianSk('mom'), adultId: 'mom', minorId: 'kid' });
    memoryTable.put({ [TABLE_PK]: userPk('mom'), [TABLE_SK]: childSk('kid'), adultId: 'mom', minorId: 'kid' });
    memoryTable.put({ [TABLE_PK]: teamPk('t1'), [TABLE_SK]: teamMetaSk(), teamId: 't1', name: 'Hawks', timeZone: 'UTC' });
    member('kid', 'player');
    member('coach', 'coach');
    member('teen-coach', 'coach');
    member('player', 'player');
    for (const [role, permissions] of [
      ['coach', ['view_medical_info']],
      ['player', []],
    ] as const) {
      memoryTable.put({ [TABLE_PK]: teamPk('t1'), [TABLE_SK]: rolePermissionsSk(role), role, permissions });
    }
  });

  it('lets a guardian fill in a child’s record, and the child read but not change it', async () => {
    expect((await call(identity, 'PUT', '/identity/medical/kid', 'kid', record)).statusCode).toBe(403);
    expect((await call(identity, 'PUT', '/identity/medical/kid', 'player', record)).statusCode).toBe(403);
    expect((await call(identity, 'PUT', '/identity/medical/kid', 'mom', record)).statusCode).toBe(200);

    const mine = JSON.parse(String((await call(identity, 'GET', '/identity/medical', 'mom')).body)) as {
      people: { userId: string; canEdit: boolean; info: { allergies?: string } }[];
    };
    expect(mine.people.map((person) => [person.userId, person.canEdit])).toEqual([
      ['mom', true],
      ['kid', true],
    ]);
    expect(mine.people[1]?.info.allergies).toBe('Peanuts');

    const theirs = JSON.parse(String((await call(identity, 'GET', '/identity/medical', 'kid')).body)) as {
      people: { userId: string; canEdit: boolean }[];
    };
    expect(theirs.people).toEqual([expect.objectContaining({ userId: 'kid', canEdit: false })]);
  });

  it('shows staff with the permission the record and guardians, logs the read, and refuses everyone else', async () => {
    await call(identity, 'PUT', '/identity/medical/kid', 'mom', record);

    const read = await call(teams, 'GET', '/teams/t1/members/kid/medical', 'coach');
    expect(read.statusCode).toBe(200);
    expect(JSON.parse(String(read.body))).toEqual({
      info: expect.objectContaining({
        allergies: 'Peanuts',
        emergencyContacts: [{ name: 'Aunt May', phone: '+12025550100', relation: 'Aunt' }],
      }),
      guardians: [{ userId: 'mom', displayName: 'Name mom', phoneNumber: '+12025550111' }],
    });
    const log = [...memoryTable.store.values()].filter((row) => String(row[TABLE_SK]).startsWith(MEDICAL_READ_SK_PREFIX));
    expect(log).toEqual([expect.objectContaining({ viewerId: 'coach', memberId: 'kid', teamId: 't1' })]);

    expect((await call(teams, 'GET', '/teams/t1/members/kid/medical', 'player')).statusCode).toBe(403);
    expect((await call(teams, 'GET', '/teams/t1/members/kid/medical', 'teen-coach')).statusCode).toBe(403);
    expect((await call(teams, 'GET', '/teams/t1/members/nobody/medical', 'coach')).statusCode).toBe(404);
  });
});
