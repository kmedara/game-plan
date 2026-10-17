/**
 * Live events update the chat and schedule caches without a screen subscription.
 */

import { createTestQueryClient } from '../test-query';
import { queryKeys } from './keys';
import { applyLiveEvent } from './live';

describe('applyLiveEvent', () => {
  it('prepends a chat message when that thread is already loaded', () => {
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.messages('c1'), {
      messages: [{ messageId: 'm0', chatId: 'c1', senderId: 'u1', senderDisplayName: 'A', body: 'hi', createdAt: '1' }],
    });
    applyLiveEvent(client, {
      type: 'chat_message',
      chatId: 'c1',
      messageId: 'm1',
      senderId: 'u2',
      senderDisplayName: 'B',
      body: 'yo',
      createdAt: '2',
    });
    expect(client.getQueryData(queryKeys.messages('c1'))).toEqual({
      messages: [
        { messageId: 'm1', chatId: 'c1', senderId: 'u2', senderDisplayName: 'B', body: 'yo', createdAt: '2' },
        { messageId: 'm0', chatId: 'c1', senderId: 'u1', senderDisplayName: 'A', body: 'hi', createdAt: '1' },
      ],
    });
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
    client.setQueryData(queryKeys.messages('c1'), { messages: [message] });
    applyLiveEvent(client, { type: 'chat_message', ...message });
    expect(client.getQueryData(queryKeys.messages('c1'))).toEqual({ messages: [message] });
  });
});
