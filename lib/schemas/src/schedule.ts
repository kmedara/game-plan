/**
 * Practice and game schedule wire contracts.
 */

import { eventTypeSchema, rsvpStatusSchema } from './enums.js';
import { z } from './zod.js';

/** Recurrence rule stored on the event item and expanded for a visible window. */
export const recurrenceRuleSchema = z
  .object({
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
    interval: z.number().int().min(1).optional(),
    until: z.string().datetime().optional(),
    count: z.number().int().min(1).optional(),
    byWeekDay: z.array(z.string().min(2).max(2)).optional(),
  })
  .strict();

/** Body for creating a practice or game. */
export const createEventBodySchema = z
  .object({
    eventType: eventTypeSchema,
    title: z.string().min(1).max(200),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional(),
    location: z.string().max(500).optional(),
    recurrence: recurrenceRuleSchema.optional(),
  })
  .strict();

/** Query for expanding events into a visible date window. */
export const scheduleWindowQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

/** Body for editing a practice or game. */
export const updateEventBodySchema = z
  .object({
    eventType: eventTypeSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.union([z.string().datetime(), z.null()]).optional(),
    location: z.union([z.string().max(500), z.null()]).optional(),
    recurrence: z.union([recurrenceRuleSchema, z.null()]).optional(),
  })
  .strict();

/** Body for a per-occurrence RSVP. */
export const rsvpBodySchema = z
  .object({
    eventId: z.string().min(1),
    occurrenceStartsAt: z.string().datetime(),
    status: rsvpStatusSchema,
  })
  .strict();

/** One RSVP entry on an expanded schedule occurrence. */
export const scheduleOccurrenceRsvpSchema = z
  .object({
    userId: z.string().min(1),
    status: z.union([rsvpStatusSchema, z.string()]),
  })
  .strict();

/** Expanded schedule occurrence from `GET /schedule/teams/:teamId`. */
export const scheduleOccurrenceSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: eventTypeSchema,
    title: z.string().min(1),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1).optional(),
    location: z.string().optional(),
    rsvps: z.array(scheduleOccurrenceRsvpSchema),
  })
  .strict();

/** Inferred type for {@link recurrenceRuleSchema}. */
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

/** Inferred type for {@link createEventBodySchema}. */
export type CreateEventBody = z.infer<typeof createEventBodySchema>;

/** Inferred type for {@link updateEventBodySchema}. */
export type UpdateEventBody = z.infer<typeof updateEventBodySchema>;

/** Inferred type for {@link scheduleWindowQuerySchema}. */
export type ScheduleWindowQuery = z.infer<typeof scheduleWindowQuerySchema>;

/** Inferred type for {@link rsvpBodySchema}. */
export type RsvpBody = z.infer<typeof rsvpBodySchema>;

/** Inferred type for {@link scheduleOccurrenceSchema}. */
export type ScheduleOccurrence = z.infer<typeof scheduleOccurrenceSchema>;
