/**
 * Live delivery payloads shared by the fan-out queue and the client socket.
 */

import { displayNameSchema } from './display-name.js';
import { chargeCurrencySchema } from './payments.js';
import { z } from './zod.js';

/**
 * Queue-only fields for a throttle retry.
 *
 * `userIds` limits delivery to that slice and skips roster lookup.
 * `attempt` counts how many slices have already been enqueued.
 * Neither field is posted to the socket or included in a push.
 */
const userIdsSchema = z.tuple([z.string().min(1)]).rest(z.string().min(1));

const retryFields = {
  userIds: userIdsSchema.optional(),
  attempt: z.number().int().min(0).max(5).optional(),
};

/** Job posted to fan-out and delivered over an open WebSocket. */
export const fanoutJobSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('schedule_changed'),
      teamId: z.string().min(1),
      eventId: z.string().min(1),
      ...retryFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('signups_changed'),
      teamId: z.string().min(1),
      eventId: z.string().min(1),
      occurrenceStartsAt: z.string().datetime(),
      ...retryFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('event_moved'),
      teamId: z.string().min(1),
      eventId: z.string().min(1),
      title: z.string().min(1).max(200),
      occurrenceStartsAt: z.string().datetime().optional(),
      change: z.enum(['time', 'location', 'both']),
      ...retryFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('event_reminder'),
      teamId: z.string().min(1),
      eventId: z.string().min(1),
      title: z.string().min(1).max(200),
      occurrenceStartsAt: z.string().datetime(),
      location: z.string().max(500).optional(),
      /**
       * `evening` is the day before at `hour` (local); `before` is `minutes`
       * ahead of the start. `hour` is the old one-hour-before job, still
       * accepted so queued jobs from before the change deliver.
       */
      kind: z.enum(['evening', 'before', 'hour']),
      hour: z.number().int().min(0).max(23).optional(),
      minutes: z.number().int().min(1).max(24 * 60).optional(),
      userIds: userIdsSchema,
      attempt: retryFields.attempt,
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
      ...retryFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('join_requested'),
      teamId: z.string().min(1),
      requestId: z.string().min(1),
      teamName: z.string().min(1).max(200),
      requesterDisplayName: displayNameSchema,
      ...retryFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('dues_reminder'),
      teamId: z.string().min(1),
      chargeId: z.string().min(1),
      title: z.string().min(1).max(200),
      amountCents: z.number().int().min(0),
      currency: chargeCurrencySchema,
      dueDate: z.string().min(1),
      kind: z.enum(['upcoming', 'due', 'overdue']),
      userIds: userIdsSchema,
      attempt: retryFields.attempt,
    })
    .strict(),
  z
    .object({
      type: z.literal('payment_received'),
      teamId: z.string().min(1),
      chargeId: z.string().min(1),
      memberId: z.string().min(1),
      title: z.string().min(1).max(200),
      amountCents: z.number().int().min(0),
      currency: chargeCurrencySchema,
      memberDisplayName: displayNameSchema.optional(),
      userIds: userIdsSchema,
      attempt: retryFields.attempt,
    })
    .strict(),
]);

/** Inferred type for {@link fanoutJobSchema}. */
export type FanoutJob = z.infer<typeof fanoutJobSchema>;
