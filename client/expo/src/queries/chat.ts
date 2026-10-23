/**
 * Chat list, message history, and the writes that update them.
 */

import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  ChatMessage,
  CreatePollBody,
  CreatePrivateChatBody,
  CreateTeamChannelBody,
  MessagePage,
  PollTally,
} from '@gameplan/types';
import type { ApiClient } from '../api';
import { queryKeys } from './keys';

export const chatsQuery = (api: Pick<ApiClient, 'listChats'>) =>
  queryOptions({ queryKey: queryKeys.chats, queryFn: () => api.listChats() });

/** Cached thread history: pages newest-first, each page newest-first. */
export type MessageHistory = InfiniteData<MessagePage, string | undefined>;

/** Messages per page; the thread fetches the next page as the reader nears the oldest one. */
export const MESSAGE_PAGE = 30;

/** Pages a refetch reloads from the newest; older pages are dropped and load again on scroll. */
export const MESSAGE_REFETCH_PAGES = 1;

export const messagesQuery = (api: Pick<ApiClient, 'listMessages'>, chatId: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.messages(chatId),
    queryFn: ({ pageParam }) =>
      api.listMessages(chatId, { limit: MESSAGE_PAGE, ...(pageParam !== undefined ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor,
    // query-core reads `pages` on every refetch, but only types it for queryClient.infiniteQuery.
    ...({ pages: MESSAGE_REFETCH_PAGES } as object),
  });

/**
 * Every loaded message in a thread, newest first.
 *
 * @param history - The cached pages, if any.
 * @returns The pages joined in order.
 */
export const historyMessages = (history: Pick<MessageHistory, 'pages'> | undefined): ChatMessage[] =>
  history?.pages.flatMap((page) => page.messages) ?? [];

/**
 * Prepends a message when that thread is already in the cache.
 *
 * Live events never create a one-message page: opening the thread should load
 * history from the API. A send on the open thread may create the page so the
 * bubble appears before the list query settles.
 *
 * @param queryClient - The app client.
 * @param message - The message to remember.
 * @param create - When true, start a page if this thread has not loaded yet.
 */
export const rememberChatMessage = (
  queryClient: QueryClient,
  message: ChatMessage,
  create = false,
): void => {
  queryClient.setQueryData(queryKeys.messages(message.chatId), (current: MessageHistory | undefined) => {
    if (current === undefined) {
      return create ? { pages: [{ messages: [message] }], pageParams: [undefined] } : current;
    }
    if (historyMessages(current).some((item) => item.messageId === message.messageId)) return current;
    const [newest, ...older] = current.pages;
    return {
      ...current,
      pages: [{ ...newest, messages: [message, ...(newest?.messages ?? [])] }, ...older],
    };
  });
};

/**
 * Updates the tally on a cached poll message.
 *
 * @param queryClient - The app client.
 * @param chatId - The chat.
 * @param messageId - The poll message.
 * @param update - Fields to replace. A live update has no `mine`, so the reader's own choices stay.
 */
export const rememberPollTally = (
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
  update: Partial<PollTally>,
): void => {
  queryClient.setQueryData(queryKeys.messages(chatId), (current: MessageHistory | undefined) => {
    if (current === undefined) return current;
    return {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        messages: page.messages.map((message) =>
          message.messageId !== messageId || message.poll === undefined
            ? message
            : { ...message, pollTally: { counts: {}, voters: 0, mine: [], ...message.pollTally, ...update } },
        ),
      })),
    };
  });
};

export const createPollMutation = (api: Pick<ApiClient, 'createPoll'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ chatId, body }: { chatId: string; body: CreatePollBody }) => api.createPoll(chatId, body),
    onSuccess: (message) => {
      rememberChatMessage(queryClient, message, true);
      return queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });

export const votePollMutation = (api: Pick<ApiClient, 'votePoll'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({ chatId, messageId, optionIds }: { chatId: string; messageId: string; optionIds: string[] }) =>
      api.votePoll(chatId, messageId, optionIds),
    onSuccess: (tally, { chatId, messageId }) => rememberPollTally(queryClient, chatId, messageId, tally),
  });

export const sendMessageMutation = (api: Pick<ApiClient, 'sendMessage'>, queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: ({
      chatId,
      body,
    }: {
      chatId: string;
      body: { body: string; attachmentKeys?: string[] };
    }) => api.sendMessage(chatId, body),
    onSuccess: (message) => {
      rememberChatMessage(queryClient, message, true);
      return queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    },
  });

export const createPrivateChatMutation = (
  api: Pick<ApiClient, 'createPrivateChat'>,
  queryClient: QueryClient,
) =>
  mutationOptions({
    mutationFn: (body: CreatePrivateChatBody) => api.createPrivateChat(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.chats }),
  });

export const createTeamChannelMutation = (
  api: Pick<ApiClient, 'createTeamChannel'>,
  queryClient: QueryClient,
) =>
  mutationOptions({
    mutationFn: ({ teamId, name }: { teamId: string; name: CreateTeamChannelBody['name'] }) =>
      api.createTeamChannel(teamId, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.chats }),
  });
