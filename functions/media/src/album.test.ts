/**
 * Team album routes: who may add and remove, plan limits, storage, and downloads.
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import {
  TABLE_PK,
  TABLE_SK,
  albumUsageSk,
  planSk,
  teamMemberSk,
  teamMetaSk,
  teamPk,
  userPk,
  userTeamSk,
} from '../../lib/dynamo/keys.js';

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);

process.env.DYNAMODB_ENDPOINT = 'http://127.0.0.1:8000';
process.env.MEDIA_BUCKET = 'gameplan-media-local';
process.env.MEDIA_PUBLIC_ORIGIN = 'http://127.0.0.1:3000';

const { handler } = await import('./handler.js');
const { getLocalObject, putLocalObject, resetMediaStore } = await import('./media-store.js');

const GIB = 1024 * 1024 * 1024;

type Caller = { userId: string; token: string };

const call = (
  caller: Caller,
  method: string,
  path: string,
  options: { body?: unknown; query?: Record<string, string> } = {},
) =>
  handler({
    version: '2.0',
    rawPath: path,
    headers: { authorization: `Bearer ${caller.token}` },
    queryStringParameters: options.query,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    isBase64Encoded: false,
    requestContext: { http: { method, path } },
  } as unknown as APIGatewayProxyEventV2);

const body = <T>(result: { body?: string }): T => JSON.parse(result.body ?? '') as T;

/** Puts a caller on the team with one role. */
const join = (teamId: string, role: string): Caller => {
  const userId = randomUUID();
  memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMemberSk(userId), teamId, userId, role });
  memoryTable.put({ [TABLE_PK]: userPk(userId), [TABLE_SK]: userTeamSk(teamId), teamId, role });
  return { userId, token: issueLocalTokens(userId, `${userId}@example.com`).accessToken };
};

/** Signs, "uploads", and adds one file, as the app does. */
const addFile = async (
  caller: Caller,
  teamId: string,
  file: { contentType: string; bytes: number; durationSeconds?: number },
) => {
  const signed = await call(caller, 'POST', `/media/teams/${teamId}/album/uploads`, {
    body: {
      contentType: file.contentType,
      contentLength: file.bytes,
      ...(file.durationSeconds !== undefined ? { durationSeconds: file.durationSeconds } : {}),
    },
  });
  if (signed.statusCode !== 200) return signed;
  const { objectKey } = body<{ objectKey: string }>(signed);
  putLocalObject(objectKey, file.contentType, Buffer.alloc(Math.min(file.bytes, 64)));
  return call(caller, 'POST', `/media/teams/${teamId}/album`, {
    body: { objectKey, ...(file.durationSeconds !== undefined ? { durationSeconds: file.durationSeconds } : {}) },
  });
};

describe('team album', () => {
  let teamId: string;

  beforeEach(() => {
    memoryTable.clear();
    resetMediaStore();
    teamId = randomUUID();
    memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: teamMetaSk(), teamId, name: 'Hawks' });
  });

  it('lets a coach add photos that every member can list and download', async () => {
    const coach = join(teamId, 'coach');
    const player = join(teamId, 'player');

    const added = await addFile(coach, teamId, { contentType: 'image/jpeg', bytes: 40 });
    expect(added.statusCode).toBe(201);
    const item = body<{ itemId: string; objectKey: string; kind: string; bytes: number; uploadedBy: string }>(added);
    expect(item).toMatchObject({ kind: 'photo', bytes: 40, uploadedBy: coach.userId });

    const page = await call(player, 'GET', `/media/teams/${teamId}/album`);
    expect(page.statusCode).toBe(200);
    expect(body<{ items: { itemId: string }[]; usedBytes: number }>(page)).toMatchObject({
      items: [{ itemId: item.itemId }],
      usedBytes: 40,
    });

    const download = await call(player, 'GET', '/media/presign-download', {
      query: { objectKey: item.objectKey, teamId },
    });
    expect(download.statusCode).toBe(200);

    const outsider = join(randomUUID(), 'coach');
    expect((await call(outsider, 'GET', `/media/teams/${teamId}/album`)).statusCode).toBe(403);
    const outsiderDownload = await call(outsider, 'GET', '/media/presign-download', {
      query: { objectKey: item.objectKey, teamId },
    });
    expect(outsiderDownload.statusCode).toBe(403);
  });

  it('lists newest first', async () => {
    const coach = join(teamId, 'coach');
    const first = body<{ itemId: string }>(await addFile(coach, teamId, { contentType: 'image/png', bytes: 10 }));
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = body<{ itemId: string }>(await addFile(coach, teamId, { contentType: 'image/png', bytes: 10 }));
    const page = body<{ items: { itemId: string }[] }>(await call(coach, 'GET', `/media/teams/${teamId}/album`));
    expect(page.items.map((item) => item.itemId)).toEqual([second.itemId, first.itemId]);
  });

  it('lets any member add, and remove what anyone added', async () => {
    const parent = join(teamId, 'parent');
    const player = join(teamId, 'player');
    const added = await addFile(parent, teamId, { contentType: 'image/jpeg', bytes: 10 });
    expect(added.statusCode).toBe(201);
    const item = body<{ itemId: string }>(added);
    expect((await call(player, 'DELETE', `/media/teams/${teamId}/album/${item.itemId}`)).statusCode).toBe(204);
  });

  it('refuses video on the free plan and allows it on a paid one, within the clip limits', async () => {
    const coach = join(teamId, 'coach');
    const clip = { contentType: 'video/mp4', bytes: 50, durationSeconds: 30 };

    const free = await addFile(coach, teamId, clip);
    expect(free.statusCode).toBe(402);
    expect(body<{ error: string }>(free).error).toBe('plan_required');

    memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: planSk(), teamId, tier: 'premium', status: 'active' });
    const paid = await addFile(coach, teamId, clip);
    expect(paid.statusCode).toBe(201);
    expect(body<{ kind: string; durationSeconds: number }>(paid)).toMatchObject({ kind: 'video', durationSeconds: 30 });

    const long = await addFile(coach, teamId, { ...clip, durationSeconds: 11 * 60 });
    expect(body<{ error: string }>(long).error).toBe('video_too_long');
    const big = await addFile(coach, teamId, { ...clip, bytes: GIB + 1 });
    expect(big.statusCode).toBe(400);
    const noLength = await call(coach, 'POST', `/media/teams/${teamId}/album/uploads`, {
      body: { contentType: 'video/mp4', contentLength: 50 },
    });
    expect(noLength.statusCode).toBe(400);
  });

  it('refuses a file that would take the album past its storage', async () => {
    const coach = join(teamId, 'coach');
    memoryTable.put({ [TABLE_PK]: teamPk(teamId), [TABLE_SK]: albumUsageSk(), bytes: 2 * GIB - 20, version: 4 });

    const full = await addFile(coach, teamId, { contentType: 'image/jpeg', bytes: 40 });
    expect(full.statusCode).toBe(402);
    expect(body<{ error: string }>(full).error).toBe('plan_limit_reached');

    expect((await addFile(coach, teamId, { contentType: 'image/jpeg', bytes: 20 })).statusCode).toBe(201);
    expect(memoryTable.get(teamPk(teamId), albumUsageSk())).toMatchObject({ bytes: 2 * GIB, version: 5 });
  });

  it('counts the stored size, not the size the app stated', async () => {
    const coach = join(teamId, 'coach');
    const signed = await call(coach, 'POST', `/media/teams/${teamId}/album/uploads`, {
      body: { contentType: 'image/jpeg', contentLength: 10 },
    });
    const { objectKey } = body<{ objectKey: string }>(signed);
    putLocalObject(objectKey, 'image/jpeg', Buffer.alloc(30));
    const added = await call(coach, 'POST', `/media/teams/${teamId}/album`, { body: { objectKey } });
    expect(body<{ bytes: number }>(added).bytes).toBe(30);
  });

  it('refuses keys that are not the caller’s upload, missing files, other types, and repeats', async () => {
    const coach = join(teamId, 'coach');
    const other = join(teamId, 'coach');
    const add = (objectKey: string) => call(coach, 'POST', `/media/teams/${teamId}/album`, { body: { objectKey } });

    const theirs = `uploads/${other.userId}/${randomUUID()}`;
    putLocalObject(theirs, 'image/jpeg', Buffer.alloc(5));
    expect(body<{ error: string }>(await add(theirs)).error).toBe('invalid_object_key');

    expect(body<{ error: string }>(await add(`uploads/${coach.userId}/${randomUUID()}`)).error).toBe(
      'upload_not_found',
    );

    const page = `uploads/${coach.userId}/${randomUUID()}`;
    putLocalObject(page, 'text/html', Buffer.alloc(5));
    expect(body<{ error: string }>(await add(page)).error).toBe('unsupported_type');

    const photo = `uploads/${coach.userId}/${randomUUID()}`;
    putLocalObject(photo, 'image/jpeg', Buffer.alloc(5));
    expect((await add(photo)).statusCode).toBe(201);
    expect((await add(photo)).statusCode).toBe(409);
  });

  it('removes an item, frees its storage, deletes the file, and stops serving it', async () => {
    const coach = join(teamId, 'coach');
    const player = join(teamId, 'player');
    const item = body<{ itemId: string; objectKey: string }>(
      await addFile(coach, teamId, { contentType: 'image/jpeg', bytes: 40 }),
    );

    const removed = await call(coach, 'DELETE', `/media/teams/${teamId}/album/${item.itemId}`);
    expect(removed.statusCode).toBe(204);
    expect(memoryTable.get(teamPk(teamId), albumUsageSk())).toMatchObject({ bytes: 0 });
    expect(getLocalObject(item.objectKey)).toBeUndefined();
    const page = body<{ items: unknown[] }>(await call(player, 'GET', `/media/teams/${teamId}/album`));
    expect(page.items).toEqual([]);
    const download = await call(player, 'GET', '/media/presign-download', {
      query: { objectKey: item.objectKey, teamId },
    });
    expect(download.statusCode).toBe(403);

    expect((await call(coach, 'DELETE', `/media/teams/${teamId}/album/${item.itemId}`)).statusCode).toBe(404);
    expect((await call(coach, 'DELETE', `/media/teams/${teamId}/album/not-an-id`)).statusCode).toBe(404);
  });
});
