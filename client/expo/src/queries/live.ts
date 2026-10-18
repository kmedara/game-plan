/**
 * Applies live socket events to the query cache so screens do not subscribe themselves.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { ChatMessage, FanoutJob } from '@gameplan/types';
import { rememberChatMessage } from './chat';
import { queryKeys } from './keys';

const messageFromEvent = (event: Extract<FanoutJob, { type: 'chat_message' }>): ChatMessage => ({
  messageId: event.messageId,
  chatId: event.chatId,
  senderId: event.senderId,
  senderDisplayName: event.senderDisplayName ?? 'Player',
  body: event.body,
  createdAt: event.createdAt,
  ...(event.attachmentKeys !== undefined ? { attachmentKeys: event.attachmentKeys } : {}),
});

/**
 * Updates cached chat and schedule values for one live event.
 *
 * @param queryClient - The app client.
 * @param event - The fanout payload.
 */
export const applyLiveEvent = (queryClient: QueryClient, event: FanoutJob): void => {
  if (event.type === 'chat_message') {
    rememberChatMessage(queryClient, messageFromEvent(event));
    void queryClient.invalidateQueries({ queryKey: queryKeys.chats });
    return;
  }
  if (event.type === 'schedule_changed' || event.type === 'event_moved' || event.type === 'event_reminder') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.teamSchedule(event.teamId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.fixtures(event.teamId) });
    return;
  }
  if (event.type === 'join_requested') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests(event.teamId) });
  }
};
