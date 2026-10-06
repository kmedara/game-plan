/**
 * Team schedule wire contracts.
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

/** Latitude in decimal degrees. */
const latitudeSchema = z.number().min(-90).max(90);

/** Longitude in decimal degrees. */
const longitudeSchema = z.number().min(-180).max(180);

/**
 * Ensures latitude and longitude are both present or both absent.
 *
 * @param value - An object that may carry coordinate fields.
 * @returns True when the pair is complete or omitted.
 */
const hasPairedCoordinates = (value: {
  latitude?: number | null;
  longitude?: number | null;
}): boolean => {
  const hasLat = value.latitude !== undefined && value.latitude !== null;
  const hasLng = value.longitude !== undefined && value.longitude !== null;
  return hasLat === hasLng;
};

/** Body for creating a team event. */
export const createEventBodySchema = z
  .object({
    eventType: eventTypeSchema,
    title: z.string().min(1).max(200),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional(),
    location: z.string().max(500).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    recurrence: recurrenceRuleSchema.optional(),
  })
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' });

/** Query for expanding events into a visible date window. */
export const scheduleWindowQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

/** Body for editing a team event. */
export const updateEventBodySchema = z
  .object({
    eventType: eventTypeSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.union([z.string().datetime(), z.null()]).optional(),
    location: z.union([z.string().max(500), z.null()]).optional(),
    latitude: z.union([latitudeSchema, z.null()]).optional(),
    longitude: z.union([longitudeSchema, z.null()]).optional(),
    recurrence: z.union([recurrenceRuleSchema, z.null()]).optional(),
  })
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' });

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
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    rsvps: z.array(scheduleOccurrenceRsvpSchema),
  })
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' });

/** `GET /schedule/teams/:teamId`. */
export const scheduleListSchema = z
  .object({
    teamId: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    occurrences: z.array(scheduleOccurrenceSchema),
  })
  .strict();

/** Created or updated event from the schedule routes. */
export const eventResponseSchema = z
  .object({
    eventId: z.string().min(1),
    teamId: z.string().min(1),
    eventType: eventTypeSchema,
    title: z.string().min(1),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1).optional(),
    location: z.string().optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    recurrence: recurrenceRuleSchema.optional(),
    createdBy: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' });

/** Stored RSVP from `PUT /schedule/teams/:teamId/rsvps`. */
export const rsvpResponseSchema = z
  .object({
    eventId: z.string().min(1),
    occurrenceStartsAt: z.string().min(1),
    userId: z.string().min(1),
    status: rsvpStatusSchema,
    updatedAt: z.string().min(1),
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

/** Inferred type for {@link scheduleListSchema}. */
export type ScheduleList = z.infer<typeof scheduleListSchema>;

/** Inferred type for {@link eventResponseSchema}. */
export type EventResponse = z.infer<typeof eventResponseSchema>;

/** Inferred type for {@link rsvpResponseSchema}. */
export type RsvpResponse = z.infer<typeof rsvpResponseSchema>;
