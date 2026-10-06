/**
 * Chat, adult search, and message wire contracts.
 */

import { chatKindSchema } from './enums.js';
import { z } from './zod.js';

/** Body for creating a team-visible channel. */
export const createTeamChannelBodySchema = z
  .object({
    teamId: z.string().min(1),
    name: z.string().min(1).max(100),
  })
  .strict();

/** Body for creating a private chat (two or more members under the minor rule). */
export const createPrivateChatBodySchema = z
  .object({
    memberIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

/**
 * Query for exact-email adult search.
 *
 * The handler applies {@link UserSearchPolicy} so a later safety pass can widen
 * who appears without a new chat model.
 */
export const searchUsersQuerySchema = z.object({
  email: z.string().email().min(3).max(320),
});

/** Query for reverse-chronological message history. */
export const messageHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});

/** Body for persisting a chat message. */
export const sendMessageBodySchema = z
  .object({
    body: z.string().min(1).max(8_000),
    attachmentKeys: z.array(z.string().min(1)).max(10).optional(),
  })
  .strict();

/** Chat summary from `GET /chats`. */
export const chatSummarySchema = z
  .object({
    chatId: z.string().min(1),
    kind: chatKindSchema,
    name: z.string().min(1),
    teamId: z.string().min(1).optional(),
  })
  .strict();

/** Chat message from history and send endpoints. */
export const chatMessageSchema = z
  .object({
    messageId: z.string().min(1),
    chatId: z.string().min(1),
    senderId: z.string().min(1),
    body: z.string().min(1),
    attachmentKeys: z.array(z.string().min(1)).optional(),
    createdAt: z.string().min(1),
  })
  .strict();

/** Inferred type for {@link createTeamChannelBodySchema}. */
export type CreateTeamChannelBody = z.infer<typeof createTeamChannelBodySchema>;

/** Inferred type for {@link createPrivateChatBodySchema}. */
export type CreatePrivateChatBody = z.infer<typeof createPrivateChatBodySchema>;

/** Inferred type for {@link searchUsersQuerySchema}. */
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;

/** Inferred type for {@link messageHistoryQuerySchema}. */
export type MessageHistoryQuery = z.infer<typeof messageHistoryQuerySchema>;

/** Inferred type for {@link sendMessageBodySchema}. */
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

/** Inferred type for {@link chatSummarySchema}. */
export type ChatSummary = z.infer<typeof chatSummarySchema>;

/** Inferred type for {@link chatMessageSchema}. */
export type ChatMessage = z.infer<typeof chatMessageSchema>;
