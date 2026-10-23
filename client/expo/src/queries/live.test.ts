/**
 * Live events update the chat and schedule caches without a screen subscription.
 */

import { createTestQueryClient } from '../test-query';
import { historyMessages, type MessageHistory } from './chat';
import { queryKeys } from './keys';
import { applyLiveEvent, resyncAfterReconnect } from './live';

/** One cached page holding these messages. */
const history = (messages: unknown[]) => ({ pages: [{ messages }], pageParams: [undefined] });

describe('applyLiveEvent', () => {
  it('prepends a chat message when that thread is already loaded', () => {
    const client = createTestQueryClient();
    client.setQueryData(
      queryKeys.messages('c1'),
      history([{ messageId: 'm0', chatId: 'c1', senderId: 'u1', senderDisplayName: 'A', body: 'hi', createdAt: '1' }]),
    );
    applyLiveEvent(client, {
      type: 'chat_message',
      chatId: 'c1',
      messageId: 'm1',
      senderId: 'u2',
      senderDisplayName: 'B',
      body: 'yo',
      createdAt: '2',
    });
    expect(client.getQueryData(queryKeys.messages('c1'))).toEqual(
      history([
        { messageId: 'm1', chatId: 'c1', senderId: 'u2', senderDisplayName: 'B', body: 'yo', createdAt: '2' },
        { messageId: 'm0', chatId: 'c1', senderId: 'u1', senderDisplayName: 'A', body: 'hi', createdAt: '1' },
      ]),
    );
  });

  it('adds a live message to the newest page and keeps older pages', () => {
    const client = createTestQueryClient();
    const older = { messageId: 'm0', chatId: 'c1', senderId: 'u1', senderDisplayName: 'A', body: 'hi', createdAt: '1' };
    client.setQueryData(queryKeys.messages('c1'), {
      pages: [{ messages: [], cursor: 'next' }, { messages: [older] }],
      pageParams: [undefined, 'next'],
    });
    applyLiveEvent(client, { type: 'chat_message', chatId: 'c1', messageId: 'm1', senderId: 'u2', body: 'yo', createdAt: '2' });
    const cached = client.getQueryData<MessageHistory>(queryKeys.messages('c1'));
    expect(cached?.pages.map((page) => page.messages.map((message) => message.messageId))).toEqual([['m1'], ['m0']]);
    expect(cached?.pages[0]?.cursor).toBe('next');
  });

  it('does not invent a message page for a thread that has not loaded', () => {
    const client = createTestQueryClient();
    applyLiveEvent(client, {
      type: 'chat_message',
      chatId: 'c1',
      messageId: 'm1',
      senderId: 'u2',
      body: 'yo',
      createdAt: '2',
    });
    expect(client.getQueryData(queryKeys.messages('c1'))).toBeUndefined();
  });

  it('keeps the sender photo so the avatar shows without a refresh', () => {
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.messages('c1'), history([]));
    applyLiveEvent(client, {
      type: 'chat_message',
      chatId: 'c1',
      messageId: 'm1',
      senderId: 'u2',
      senderDisplayName: 'B',
      senderPhotoKey: 'profiles/u2/photo.jpg',
      body: 'yo',
      createdAt: '2',
    });
    expect(client.getQueryData(queryKeys.messages('c1'))).toEqual(
      history([expect.objectContaining({ senderPhotoKey: 'profiles/u2/photo.jpg' })]),
    );
  });

  it('ignores a duplicate live message', () => {
    const client = createTestQueryClient();
    const message = {
      messageId: 'm1',
      chatId: 'c1',
      senderId: 'u2',
      senderDisplayName: 'B',
      body: 'yo',
      createdAt: '2',
    };
    client.setQueryData(queryKeys.messages('c1'), history([message]));
    applyLiveEvent(client, { type: 'chat_message', ...message });
    expect(client.getQueryData(queryKeys.messages('c1'))).toEqual(history([message]));
  });
});

describe('resyncAfterReconnect', () => {
  it('marks chat, schedule, and dues data stale so missed events are fetched', () => {
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.messages('c1'), history([]));
    client.setQueryData(queryKeys.chats, []);
    client.setQueryData(queryKeys.schedule('t1', 'a', 'b'), { teamId: 't1', from: 'a', to: 'b', occurrences: [] });
    client.setQueryData(queryKeys.myDues, []);
    client.setQueryData(queryKeys.members('t1'), []);

    resyncAfterReconnect(client);

    const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
    expect(stale(queryKeys.messages('c1'))).toBe(true);
    expect(stale(queryKeys.chats)).toBe(true);
    expect(stale(queryKeys.schedule('t1', 'a', 'b'))).toBe(true);
    expect(stale(queryKeys.myDues)).toBe(true);
    expect(stale(queryKeys.members('t1'))).toBe(false);
  });
});

describe('poll updates', () => {
  it('replaces counts on a cached poll and keeps the reader’s own choices', () => {
    const client = createTestQueryClient();
    client.setQueryData(
      queryKeys.messages('c1'),
      history([
        {
          messageId: 'p1',
          chatId: 'c1',
          senderId: 'u1',
          senderDisplayName: 'A',
          body: 'Pizza?',
          createdAt: '1',
          poll: { question: 'Pizza?', options: [{ id: 'o1', text: 'Yes' }, { id: 'o2', text: 'No' }], multiple: false },
          pollTally: { counts: { o1: 1 }, voters: 1, mine: ['o1'] },
        },
      ]),
    );
    applyLiveEvent(client, { type: 'poll_updated', chatId: 'c1', messageId: 'p1', counts: { o1: 1, o2: 2 }, voters: 3 });
    const messages = historyMessages(client.getQueryData<MessageHistory>(queryKeys.messages('c1')));
    expect(messages[0]?.pollTally).toEqual({ counts: { o1: 1, o2: 2 }, voters: 3, mine: ['o1'] });
  });
});
