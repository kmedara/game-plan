/**
 * Chat list, message history, and the writes that update them.
 */

import { mutationOptions, queryOptions, type QueryClient } from '@tanstack/react-query';
import type { ChatMessage, CreatePrivateChatBody, CreateTeamChannelBody, MessagePage } from '@gameplan/types';
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
    mutationFn: (memberIds: CreatePrivateChatBody['memberIds']) => api.createPrivateChat(memberIds),
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
