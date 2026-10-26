/**
 * Applies live socket events to the query cache so screens do not subscribe themselves.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { ChatMessage, FanoutJob } from '@gameplan/types';
import { rememberChatMessage, rememberPollTally } from './chat';
import { queryKeys } from './keys';

const messageFromEvent = (event: Extract<FanoutJob, { type: 'chat_message' }>): ChatMessage => ({
  messageId: event.messageId,
  chatId: event.chatId,
  senderId: event.senderId,
  senderDisplayName: event.senderDisplayName ?? 'Player',
  ...(event.senderPhotoKey !== undefined ? { senderPhotoKey: event.senderPhotoKey } : {}),
  body: event.body,
  createdAt: event.createdAt,
  ...(event.attachmentKeys !== undefined ? { attachmentKeys: event.attachmentKeys } : {}),
  ...(event.poll !== undefined ? { poll: event.poll, pollTally: { counts: {}, voters: 0, mine: [] } } : {}),
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
    return;
  }
  if (event.type === 'poll_updated') {
    rememberPollTally(queryClient, event.chatId, event.messageId, { counts: event.counts, voters: event.voters });
    return;
  }
  if (event.type === 'signups_changed') {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.signups(event.teamId, event.eventId, event.occurrenceStartsAt),
    });
    return;
  }
  if (event.type === 'dues_reminder' || event.type === 'payment_received') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.myDues });
    void queryClient.invalidateQueries({ queryKey: queryKeys.charges(event.teamId) });
    void queryClient.invalidateQueries({ queryKey: ['charge', event.teamId] });
    return;
  }
  if (event.type === 'waiver_reminder') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.myWaivers });
  }
};

/**
 * Refetches what live events would have updated, after the socket was down.
 *
 * Only queries on screen refetch now; the rest are marked stale and load
 * fresh when next opened.
 *
 * @param queryClient - The app client.
 */
export const resyncAfterReconnect = (queryClient: QueryClient): void => {
  for (const kind of ['chats', 'messages', 'schedule', 'fixtures', 'signups', 'joinRequests', 'myDues', 'charges', 'charge', 'myWaivers']) {
    void queryClient.invalidateQueries({ queryKey: [kind] });
  }
};
