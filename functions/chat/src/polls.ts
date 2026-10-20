/**
 * Polls in chat.
 *
 * A poll is a chat message with a `poll` field, so it sorts, pages, and
 * notifies like any message. Its definition is also stored at
 * `CHAT#<chatId>` / `POLL#<messageId>` so a vote can find it by id. Each
 * person's choice is its own row, `VOTE#<messageId>#<userId>`, so votes
 * never rewrite the message and two voters never collide. Tallies are
 * counted when messages are read.
 */

import type { CreatePollBody } from '@gameplan/schemas';
import type { ChatMessage, Poll, PollTally } from '@gameplan/types';
import {
  TABLE_PK,
  TABLE_SK,
  chatPk,
  deleteItem,
  getItem,
  pollSk,
  pollVoteSk,
  pollVoteSkPrefix,
  putItem,
  queryBySkPrefix,
} from '../../lib/dynamo/index.js';
import { enqueueFanout } from '../../lib/fanout-enqueue.js';
import { requireChat, requireChatMembership, sendMessage } from './chat-store.js';

/** One stored vote. */
type VoteItem = { userId: string; optionIds: string[] };

/**
 * Counts votes on one poll.
 *
 * @param chatId - The chat.
 * @param messageId - The poll message.
 * @param viewerId - Whose own choices to report.
 * @returns Counts per option, how many voted, and the viewer's choices.
 */
export const tallyPoll = async (chatId: string, messageId: string, viewerId: string): Promise<PollTally> => {
  const votes = await queryBySkPrefix<VoteItem>(chatPk(chatId), pollVoteSkPrefix(messageId));
  const counts: Record<string, number> = {};
  for (const vote of votes) for (const id of vote.optionIds) counts[id] = (counts[id] ?? 0) + 1;
  return {
    counts,
    voters: votes.length,
    mine: votes.find((vote) => vote.userId === viewerId)?.optionIds ?? [],
  };
};

/**
 * Adds tallies to the poll messages in a page.
 *
 * @param chatId - The chat.
 * @param messages - A page of messages.
 * @param viewerId - The reader.
 * @returns The same messages, poll ones with `pollTally`.
 */
export const withPollTallies = async (
  chatId: string,
  messages: readonly ChatMessage[],
  viewerId: string,
): Promise<ChatMessage[]> =>
  Promise.all(
    messages.map(async (message) =>
      message.poll === undefined ? message : { ...message, pollTally: await tallyPoll(chatId, message.messageId, viewerId) },
    ),
  );

/**
 * Posts a poll to a chat.
 *
 * @param input - Chat, author, and the question and options.
 * @returns The poll message.
 */
export const createPoll = async (input: { chatId: string; userId: string; body: CreatePollBody }): Promise<ChatMessage> => {
  const texts = input.body.options.map((text) => text.trim());
  if (new Set(texts.map((text) => text.toLowerCase())).size !== texts.length) throw new Error('poll_duplicate_option');
  if (input.body.closesAt !== undefined && new Date(input.body.closesAt).getTime() <= Date.now()) {
    throw new Error('poll_closed');
  }
  const poll: Poll = {
    question: input.body.question,
    options: texts.map((text, index) => ({ id: `o${index + 1}`, text })),
    multiple: input.body.multiple,
    ...(input.body.closesAt !== undefined ? { closesAt: input.body.closesAt } : {}),
  };
  return sendMessage({ chatId: input.chatId, userId: input.userId, body: { body: poll.question }, poll });
};

/**
 * Records, changes, or takes back a vote, then tells the chat the new counts.
 *
 * @param input - Chat, poll message, voter, and the chosen option ids.
 * @returns The new tally for the voter.
 */
export const votePoll = async (input: {
  chatId: string;
  messageId: string;
  userId: string;
  optionIds: readonly string[];
}): Promise<PollTally> => {
  await requireChat(input.chatId);
  await requireChatMembership(input.chatId, input.userId);
  const stored = await getItem<{ poll?: Poll }>(chatPk(input.chatId), pollSk(input.messageId));
  const poll = stored?.poll;
  if (poll === undefined) throw new Error('poll_not_found');
  if (poll.closesAt !== undefined && new Date(poll.closesAt).getTime() <= Date.now()) throw new Error('poll_closed');
  const chosen = [...new Set(input.optionIds)];
  const valid = new Set(poll.options.map((option) => option.id));
  if (chosen.some((id) => !valid.has(id))) throw new Error('poll_option_not_found');
  if (!poll.multiple && chosen.length > 1) throw new Error('poll_single_choice');

  const key = { [TABLE_PK]: chatPk(input.chatId), [TABLE_SK]: pollVoteSk(input.messageId, input.userId) };
  if (chosen.length === 0) {
    await deleteItem(key[TABLE_PK], key[TABLE_SK]);
  } else {
    await putItem({ ...key, userId: input.userId, optionIds: chosen, votedAt: new Date().toISOString() });
  }

  const tally = await tallyPoll(input.chatId, input.messageId, input.userId);
  await enqueueFanout({
    type: 'poll_updated',
    chatId: input.chatId,
    messageId: input.messageId,
    counts: tally.counts,
    voters: tally.voters,
  });
  return tally;
};
