/**
 * Polls in chat: posting, voting rules, tallies, and live updates.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueLocalTokens } from '../../lib/auth/local-jwt.js';
import { memoryTable } from '../../lib/dynamo/memory-table.js';
import { TABLE_PK, TABLE_SK, chatMemberSk, chatMetaSk, chatPk } from '../../lib/dynamo/keys.js';

const { fanoutJobs } = vi.hoisted(() => ({ fanoutJobs: [] as Array<Record<string, unknown>> }));

vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);
vi.mock('../../lib/fanout-enqueue.js', () => ({
  enqueueFanout: async (job: Record<string, unknown>): Promise<void> => {
    fanoutJobs.push(job);
  },
  resetFanoutSqsClient: (): void => undefined,
}));

const { handler } = await import('./handler.js');

const call = async (method: string, path: string, userId: string, body?: unknown) => {
  const result = (await handler({
    version: '2.0',
    rawPath: path,
    headers: {
      authorization: `Bearer ${issueLocalTokens(userId, `${userId}@example.com`).accessToken}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, path } },
  } as unknown as APIGatewayProxyEventV2)) as APIGatewayProxyStructuredResultV2;
  return { status: result.statusCode, body: JSON.parse(String(result.body ?? '{}')) as Record<string, unknown> };
};

type Message = { messageId: string; body: string; poll?: { options: { id: string; text: string }[] }; pollTally?: Record<string, unknown> };

describe('chat polls', () => {
  beforeEach(() => {
    memoryTable.clear();
    fanoutJobs.length = 0;
    memoryTable.put({ [TABLE_PK]: chatPk('c1'), [TABLE_SK]: chatMetaSk(), chatId: 'c1', kind: 'default', name: 'Hawks', createdBy: 'ana', createdAt: '2026-01-01' });
    for (const userId of ['ana', 'ben', 'cal']) {
      memoryTable.put({ [TABLE_PK]: chatPk('c1'), [TABLE_SK]: chatMemberSk(userId), chatId: 'c1', userId });
    }
  });

  const postPoll = (body: Record<string, unknown>) =>
    call('POST', '/chat/c1/polls', 'ana', { question: 'Pizza after the game?', options: ['Yes', 'No'], ...body });

  it('posts a poll as a message that notifies like any other', async () => {
    const posted = await postPoll({});
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({
      body: 'Pizza after the game?',
      poll: { options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }], multiple: false },
      pollTally: { counts: {}, voters: 0, mine: [] },
    });
    expect(fanoutJobs).toEqual([expect.objectContaining({ type: 'chat_message', body: 'Pizza after the game?', poll: expect.any(Object) })]);
    expect((await call('POST', '/chat/c1/polls', 'ana', { question: 'One?', options: ['Only'] })).status).toBe(400);
    expect((await postPoll({ options: ['Yes', 'yes'] })).body).toEqual({ error: 'poll_duplicate_option' });
  });

  it('counts votes, lets people change or take back a vote, and shows each reader their own', async () => {
    const { messageId } = (await postPoll({})).body as { messageId: string };
    const vote = (userId: string, optionIds: string[]) => call('PUT', `/chat/c1/polls/${messageId}/vote`, userId, { optionIds });

    await vote('ben', ['o1']);
    await vote('cal', ['o1']);
    expect((await vote('cal', ['o2'])).body).toEqual({ counts: { o1: 1, o2: 1 }, voters: 2, mine: ['o2'] });
    expect(fanoutJobs.at(-1)).toEqual(
      expect.objectContaining({ type: 'poll_updated', chatId: 'c1', messageId, counts: { o1: 1, o2: 1 }, voters: 2 }),
    );
    await vote('ben', []);

    const history = (await call('GET', '/chat/c1/messages', 'cal')).body.messages as Message[];
    expect(history[0]?.pollTally).toEqual({ counts: { o2: 1 }, voters: 1, mine: ['o2'] });
  });

  it('refuses a second choice on a single-choice poll, unknown options, closed polls, and non-members', async () => {
    const { messageId } = (await postPoll({})).body as { messageId: string };
    const vote = (userId: string, optionIds: string[]) => call('PUT', `/chat/c1/polls/${messageId}/vote`, userId, { optionIds });
    expect((await vote('ben', ['o1', 'o2'])).body).toEqual({ error: 'poll_single_choice' });
    expect((await vote('ben', ['o9'])).body).toEqual({ error: 'poll_option_not_found' });
    expect((await vote('stranger', ['o1'])).status).toBe(403);
    expect((await call('PUT', '/chat/c1/polls/missing/vote', 'ben', { optionIds: ['o1'] })).status).toBe(404);

    const multi = (await postPoll({ multiple: true })).body as { messageId: string };
    expect(
      (await call('PUT', `/chat/c1/polls/${multi.messageId}/vote`, 'ben', { optionIds: ['o1', 'o2'] })).body,
    ).toMatchObject({ voters: 1, mine: ['o1', 'o2'] });

    expect((await postPoll({ closesAt: '2020-01-01T00:00:00.000Z' })).body).toEqual({ error: 'poll_closed' });
  });
});
