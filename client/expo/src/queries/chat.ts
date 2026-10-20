/**
 * Chat list, message history, and the writes that update them.
 */

import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
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

export const messagesQuery = (api: Pick<ApiClient, 'listMessages'>, chatId: string) =>
  queryOptions({
    queryKey: queryKeys.messages(chatId),
    queryFn: () => api.listMessages(chatId),
  });

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
  queryClient.setQueryData(queryKeys.messages(message.chatId), (current: MessagePage | undefined) => {
    if (current === undefined) return create ? { messages: [message] } : current;
    if (current.messages.some((item) => item.messageId === message.messageId)) return current;
    return { ...current, messages: [message, ...current.messages] };
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
  queryClient.setQueryData(queryKeys.messages(chatId), (current: MessagePage | undefined) => {
    if (current === undefined) return current;
    return {
      ...current,
      messages: current.messages.map((message) =>
        message.messageId !== messageId || message.poll === undefined
          ? message
          : { ...message, pollTally: { counts: {}, voters: 0, mine: [], ...message.pollTally, ...update } },
      ),
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
