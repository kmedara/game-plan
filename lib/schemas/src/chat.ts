/**
 * Chat, teammate search, and message wire contracts.
 */

import { displayNameSchema, personNameSchema } from './display-name.js';
import { accountKindSchema, chatKindSchema } from './enums.js';
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
    /** Shown in the chat list. Omitted chats are listed under the other members' names. */
    name: z.string().min(1).max(100).optional(),
  })
  .strict();

/**
 * One person in the minor chat check.
 *
 * This is not a wire response. The rule needs the account kind and the teams
 * the person already belongs to.
 */
export const chatParticipantSchema = z
  .object({
    userId: z.string().min(1),
    accountKind: accountKindSchema,
    teamIds: z.array(z.string().min(1)),
    /** Adults linked to this minor. Omitted for adults. */
    guardianIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** Inferred type for {@link chatParticipantSchema}. */
export type ChatParticipant = z.infer<typeof chatParticipantSchema>;

/**
 * Filter for who appears in user search.
 *
 * A later safety pass can widen the filter without a new chat model.
 */
export const userSearchPolicySchema = z
  .object({
    adultsOnly: z.boolean(),
  })
  .strict();

/** Inferred type for {@link userSearchPolicySchema}. */
export type UserSearchPolicy = z.infer<typeof userSearchPolicySchema>;

/**
 * Query for searching the caller's teammates by first, last, or display name.
 *
 * Matches the start of any name word, so `ada`, `love`, and `ada lo` all find
 * Ada Lovelace.
 */
export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

/** One teammate found by name, read from the roster rows the caller shares with them. */
export const teammateMatchSchema = z.object({
  userId: z.string().min(1),
  displayName: displayNameSchema,
  firstName: personNameSchema.optional(),
  lastName: personNameSchema.optional(),
  /** Teams the caller and this person are both on. */
  teamIds: z.array(z.string().min(1)).min(1),
});

/** Response for `GET /chat/users/search`, sorted by display name. */
export const teammateSearchResultSchema = z.object({
  users: z.array(teammateMatchSchema),
});

/** Query for reverse-chronological message history. */
export const messageHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});

/** Most choices one poll may offer. */
export const MAX_POLL_OPTIONS = 10;

/** A poll attached to a chat message. The message body repeats the question. */
export const pollSchema = z
  .object({
    question: z.string().min(1).max(300),
    // At least two on creation (`createPollBodySchema`); not repeated here, so
    // the generated type stays a plain array.
    options: z
      .array(z.object({ id: z.string().min(1).max(12), text: z.string().min(1).max(100) }).strict())
      .max(MAX_POLL_OPTIONS),
    /** Voters may pick more than one option. */
    multiple: z.boolean(),
    /** After this instant votes are refused (ISO). */
    closesAt: z.string().datetime().optional(),
  })
  .strict();

/** Vote counts on a poll, and the viewer's own choices. */
export const pollTallySchema = z
  .object({
    /** Votes per option id. */
    counts: z.record(z.string(), z.number().int().min(0)),
    /** People who have voted. */
    voters: z.number().int().min(0),
    /** Option ids the viewer picked. */
    mine: z.array(z.string()),
  })
  .strict();

/** Body for `POST /chat/:chatId/polls`. */
export const createPollBodySchema = z
  .object({
    question: z.string().trim().min(1).max(300),
    options: z
      .array(z.string().trim().min(1).max(100))
      .max(MAX_POLL_OPTIONS)
      .refine((options) => options.length >= 2, { message: 'Add at least two options' }),
    multiple: z.boolean().default(false),
    closesAt: z.string().datetime().optional(),
  })
  .strict();

/** Body for `PUT /chat/:chatId/polls/:messageId/vote`. An empty list takes the vote back. */
export const pollVoteBodySchema = z
  .object({
    optionIds: z.array(z.string().min(1).max(12)).max(MAX_POLL_OPTIONS),
  })
  .strict();

/** Body for persisting a chat message. */
export const sendMessageBodySchema = z
  .object({
    /** Caption text; may be empty when `attachmentKeys` has at least one image. */
    body: z.string().max(8_000),
    attachmentKeys: z.array(z.string().min(1).max(512)).max(10).optional(),
  })
  .strict();

/** Chat summary from `GET /chats`. */
export const chatSummarySchema = z
  .object({
    chatId: z.string().min(1),
    kind: chatKindSchema,
    name: z.string().min(1),
    teamId: z.string().min(1).optional(),
    createdBy: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();

/** `GET /chat`. */
export const chatListSchema = z
  .object({
    chats: z.array(chatSummarySchema),
  })
  .strict();

/** Chat message from history and send endpoints. */
export const chatMessageSchema = z
  .object({
    messageId: z.string().min(1),
    chatId: z.string().min(1),
    senderId: z.string().min(1),
    /** Current profile name of the sender. */
    senderDisplayName: displayNameSchema,
    /** Media object key for the sender's profile photo, when they have one. */
    senderPhotoKey: z.string().min(1).max(512).optional(),
    /** Caption text; empty when the message is image-only. */
    body: z.string().max(8_000),
    attachmentKeys: z.array(z.string().min(1).max(512)).optional(),
    createdAt: z.string().min(1),
    poll: pollSchema.optional(),
    /** Present on a poll message. */
    pollTally: pollTallySchema.optional(),
  })
  .strict();

/** `GET /chat/:chatId/messages`. */
export const messagePageSchema = z
  .object({
    messages: z.array(chatMessageSchema),
    cursor: z.string().min(1).optional(),
  })
  .strict();

/** Inferred type for {@link createTeamChannelBodySchema}. */
export type CreateTeamChannelBody = z.infer<typeof createTeamChannelBodySchema>;

/** Inferred type for {@link createPrivateChatBodySchema}. */
export type CreatePrivateChatBody = z.infer<typeof createPrivateChatBodySchema>;

/** Inferred type for {@link searchUsersQuerySchema}. */
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;

/** Inferred type for {@link teammateMatchSchema}. */
export type TeammateMatch = z.infer<typeof teammateMatchSchema>;

/** Inferred type for {@link teammateSearchResultSchema}. */
export type TeammateSearchResult = z.infer<typeof teammateSearchResultSchema>;

/** Inferred type for {@link messageHistoryQuerySchema}. */
export type MessageHistoryQuery = z.infer<typeof messageHistoryQuerySchema>;

/** Inferred type for {@link sendMessageBodySchema}. */
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

/** Inferred type for {@link chatSummarySchema}. */
export type ChatSummary = z.infer<typeof chatSummarySchema>;

/** Inferred type for {@link chatMessageSchema}. */
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Inferred type for {@link chatListSchema}. */
export type ChatList = z.infer<typeof chatListSchema>;

/** Inferred type for {@link messagePageSchema}. */
export type MessagePage = z.infer<typeof messagePageSchema>;

/** Inferred type for {@link pollSchema}. */
export type Poll = z.infer<typeof pollSchema>;

/** Inferred type for {@link pollTallySchema}. */
export type PollTally = z.infer<typeof pollTallySchema>;

/** Inferred type for {@link createPollBodySchema}. */
export type CreatePollBody = z.infer<typeof createPollBodySchema>;

/** Inferred type for {@link pollVoteBodySchema}. */
export type PollVoteBody = z.infer<typeof pollVoteBodySchema>;
