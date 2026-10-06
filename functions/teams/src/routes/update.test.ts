/**
 * Update team route validation after the shared schema passes.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { issueLocalTokens } from '../../../lib/auth/local-jwt.js';
import { TABLE_PK, TABLE_SK, teamMemberSk, teamMetaSk, teamPk } from '../../../lib/dynamo/keys.js';

const store = new Map<string, Record<string, unknown>>();
const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

vi.mock('@gameplan/schemas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gameplan/schemas')>();
  return {
    ...actual,
    updateTeamBodySchema: z
      .object({
        name: z.string().optional(),
        timeZone: z.string().optional(),
        location: z.union([z.string(), z.null()]).optional(),
        theme: z.union([z.record(z.unknown()), z.null()]).optional(),
      })
      .strict(),
  };
});

vi.mock('../../../lib/dynamo/access.js', () => ({
  getItem: async <T extends Record<string, unknown>>(pk: string, sk: string) =>
    store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (item: Record<string, unknown>): Promise<void> => {
    store.set(itemKey(String(item[TABLE_PK]), String(item[TABLE_SK])), item);
  },
  transactWrite: async (): Promise<void> => undefined,
  queryBySkPrefix: async () => [],
  queryPage: async () => ({ items: [] }),
  queryAll: async () => [],
  queryPartition: async () => [],
  encodeCursor: () => undefined,
  decodeCursor: () => undefined,
}));

const { handler } = await import('../handler.js');

const httpEvent = (
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): APIGatewayProxyEventV2 =>
  ({
    version: '2.0',
    rawPath: path,
    headers: options.headers ?? {},
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    requestContext: { http: { method, path } },
  }) as APIGatewayProxyEventV2;

describe('handleUpdateTeam name trimming', () => {
  beforeEach(() => {
    store.clear();
    process.env.LOCAL_JWT_SECRET = 'update-route-test-secret';
  });

  afterEach(() => {
    store.clear();
  });

  it('rejects whitespace-only name and time zone values', async () => {
    const userId = crypto.randomUUID();
    const teamId = crypto.randomUUID();
    const { accessToken } = issueLocalTokens(userId, `${userId}@example.com`);
    store.set(itemKey(teamPk(teamId), teamMetaSk()), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMetaSk(),
      teamId,
      name: 'Hawks',
      timeZone: 'UTC',
      defaultChatId: crypto.randomUUID(),
      createdBy: userId,
      createdAt: new Date().toISOString(),
    });
    store.set(itemKey(teamPk(teamId), teamMemberSk(userId)), {
      [TABLE_PK]: teamPk(teamId),
      [TABLE_SK]: teamMemberSk(userId),
      userId,
      role: 'team_admin',
      joinedAt: new Date().toISOString(),
    });

    const badName = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { name: '   ' },
      }),
    );
    expect(badName.statusCode).toBe(400);

    const badZone = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { timeZone: '  ' },
      }),
    );
    expect(badZone.statusCode).toBe(400);

    const clearedLocation = await handler(
      httpEvent('PATCH', `/teams/${teamId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { location: '   ' },
      }),
    );
    expect(clearedLocation.statusCode).toBe(200);
    expect(JSON.parse(clearedLocation.body ?? '').location).toBeUndefined();
  });
});
