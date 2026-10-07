/**
 * Live delivery payloads shared by the fan-out queue and the client socket.
 */

import { displayNameSchema } from './display-name.js';
import { z } from './zod.js';

/** Job posted to fan-out and delivered over an open WebSocket. */
export const fanoutJobSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('schedule_changed'),
      teamId: z.string().min(1),
      eventId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('chat_message'),
      chatId: z.string().min(1),
      messageId: z.string().min(1),
      senderId: z.string().min(1),
      /** Current profile name, so a live message can show it without another fetch. */
      senderDisplayName: displayNameSchema.optional(),
      /** Media object key for the sender's profile photo, when they have one. */
      senderPhotoKey: z.string().min(1).max(512).optional(),
      /** Caption text; empty when the message is image-only. */
      body: z.string().max(8_000),
      createdAt: z.string().min(1),
      attachmentKeys: z.array(z.string().min(1).max(512)).optional(),
    })
    .strict(),
]);

/** Inferred type for {@link fanoutJobSchema}. */
export type FanoutJob = z.infer<typeof fanoutJobSchema>;
