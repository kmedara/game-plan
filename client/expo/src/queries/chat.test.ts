/**
 * Thread history pages: scrolling back loads older pages, and a refetch reloads only the newest ones.
 */

import { InfiniteQueryObserver } from '@tanstack/react-query';
import type { MessagePage } from '@gameplan/types';
import { createTestQueryClient } from '../test-query';
import { MESSAGE_REFETCH_PAGES, messagesQuery, type MessageHistory } from './chat';
import { queryKeys } from './keys';

const page = (id: string, cursor?: string): MessagePage => ({
  messages: [{ messageId: id, chatId: 'c1', senderId: 'u1', senderDisplayName: 'A', body: id, createdAt: id }],
  ...(cursor !== undefined ? { cursor } : {}),
});

describe('messagesQuery', () => {
  it(`refetches only the newest ${MESSAGE_REFETCH_PAGES} pages and drops older ones`, async () => {
    const client = createTestQueryClient();
    const listMessages = jest.fn((_chatId: string, options: { cursor?: string } = {}) =>
      Promise.resolve(options.cursor === undefined ? page('new1', 'p2') : page(`new-${options.cursor}`, 'p3')),
    );
    client.setQueryData<MessageHistory>(queryKeys.messages('c1'), {
      pages: [page('m1', 'p2'), page('m2', 'p3'), page('m3', 'p4'), page('m4')],
      pageParams: [undefined, 'p2', 'p3', 'p4'],
    });
    const observer = new InfiniteQueryObserver(client, messagesQuery({ listMessages }, 'c1'));

    await observer.refetch();

    expect(listMessages).toHaveBeenCalledTimes(MESSAGE_REFETCH_PAGES);
    const cached = client.getQueryData<MessageHistory>(queryKeys.messages('c1'));
    expect(cached?.pages.map((item) => item.messages[0]?.messageId)).toEqual(['new1']);
    expect(cached?.pageParams).toEqual([undefined, 'p2']);
  });

  it('loads the page before the oldest one when scrolling back', async () => {
    const client = createTestQueryClient();
    const listMessages = jest.fn(() => Promise.resolve(page('m3')));
    client.setQueryData<MessageHistory>(queryKeys.messages('c1'), {
      pages: [page('m1', 'p2'), page('m2', 'p3')],
      pageParams: [undefined, 'p2'],
    });
    const observer = new InfiniteQueryObserver(client, messagesQuery({ listMessages }, 'c1'));

    await observer.fetchNextPage();

    expect(listMessages).toHaveBeenCalledWith('c1', { limit: 30, cursor: 'p3' });
    expect(client.getQueryData<MessageHistory>(queryKeys.messages('c1'))?.pages).toHaveLength(3);
  });
});
