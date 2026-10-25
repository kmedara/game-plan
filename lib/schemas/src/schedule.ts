/**
 * Team schedule wire contracts.
 */

import { eventTypeSchema, fixtureStatusSchema, gameSideSchema, rsvpStatusSchema } from './enums.js';
import { httpsUrlSchema, webcalUrlSchema } from './links.js';
import { teamPositionSchema } from './teams.js';
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

/** Opponent label on a game. A linked fixture replaces this with the other club's name. */
const opponentNameSchema = z.string().trim().min(1).max(100);

/**
 * Opponent and side belong only on games.
 *
 * @param body - A create or patch body.
 * @param ctx - The Zod issue collector.
 */
const rejectGameFieldsOnOtherTypes = (
  body: { eventType?: string; opponentName?: string | null; side?: string | null },
  ctx: z.RefinementCtx,
): void => {
  if (body.eventType === undefined || body.eventType === 'game') return;
  if (body.opponentName !== undefined && body.opponentName !== null) {
    ctx.addIssue({ code: 'custom', message: 'not_a_game', path: ['opponentName'] });
  }
  if (body.side !== undefined && body.side !== null) {
    ctx.addIssue({ code: 'custom', message: 'not_a_game', path: ['side'] });
  }
};

/**
 * Meetings and other events need a title. Practices and games are named from
 * their type, side, and opponent, so the server ignores a title sent for them.
 *
 * @param body - A create body.
 * @param ctx - The Zod issue collector.
 */
const requireTitleOnNamedTypes = (
  body: { eventType: string; title?: string },
  ctx: z.RefinementCtx,
): void => {
  if (body.eventType === 'practice' || body.eventType === 'game') return;
  if (body.title === undefined) ctx.addIssue({ code: 'custom', message: 'title_required', path: ['title'] });
};

/** Body for creating a team event. */
export const createEventBodySchema = z
  .object({
    eventType: eventTypeSchema,
    title: z.string().min(1).max(200).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional(),
    location: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    recurrence: recurrenceRuleSchema.optional(),
    opponentName: opponentNameSchema.optional(),
    side: gameSideSchema.optional(),
  })
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' })
  .superRefine(rejectGameFieldsOnOtherTypes)
  .superRefine(requireTitleOnNamedTypes);

/** Query for expanding events into a visible date window. */
export const scheduleWindowQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

const eventPatchShape = {
  eventType: eventTypeSchema.optional(),
  title: z.string().min(1).max(200).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.union([z.string().datetime(), z.null()]).optional(),
  location: z.union([z.string().max(500), z.null()]).optional(),
  notes: z.union([z.string().max(2000), z.null()]).optional(),
  latitude: z.union([latitudeSchema, z.null()]).optional(),
  longitude: z.union([longitudeSchema, z.null()]).optional(),
  recurrence: z.union([recurrenceRuleSchema, z.null()]).optional(),
  opponentName: z.union([opponentNameSchema, z.null()]).optional(),
  side: z.union([gameSideSchema, z.null()]).optional(),
};

/** Body for editing a team event. */
export const updateEventBodySchema = z
  .object(eventPatchShape)
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' })
  .superRefine(rejectGameFieldsOnOtherTypes);

/** Identifies one expanded instant of a series. */
export const occurrenceTargetSchema = z
  .object({
    occurrenceStartsAt: z.string().datetime(),
  })
  .strict();

/** Body for changing one date of a series without rewriting the rest. */
export const exceptionEventBodySchema = z
  .object({
    occurrenceStartsAt: z.string().datetime(),
    ...eventPatchShape,
  })
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' })
  .superRefine(rejectGameFieldsOnOtherTypes);

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
    status: rsvpStatusSchema,
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
    notes: z.string().optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    recurring: z.boolean(),
    seriesEventId: z.string().min(1).optional(),
    originalStartsAt: z.string().datetime().optional(),
    opponentName: z.string().min(1).optional(),
    side: gameSideSchema.optional(),
    fixtureId: z.string().min(1).optional(),
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
    notes: z.string().optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    recurrence: recurrenceRuleSchema.optional(),
    seriesEventId: z.string().min(1).optional(),
    originalStartsAt: z.string().datetime().optional(),
    exdates: z.array(z.string().datetime()).optional(),
    opponentName: z.string().min(1).optional(),
    side: gameSideSchema.optional(),
    fixtureId: z.string().min(1).optional(),
    createdBy: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' });

/** One player assigned to a position in a game lineup. */
export const lineupSlotSchema = z
  .object({
    userId: z.string().min(1),
    position: teamPositionSchema,
  })
  .strict();

/** Query for one occurrence lineup. */
export const lineupQuerySchema = z
  .object({
    eventId: z.string().min(1),
    occurrenceStartsAt: z.string().datetime(),
    /** When `previous`, return the latest earlier game lineup in the same series. */
    source: z.enum(['current', 'previous']).optional(),
  })
  .strict();

/**
 * Body for replacing a game lineup.
 *
 * `version` is the one the editor loaded, omitted when it loaded no lineup or
 * one saved before versions. A save based on an older lineup is refused with
 * `lineup_changed` instead of replacing someone else's.
 */
export const lineupBodySchema = z
  .object({
    eventId: z.string().min(1),
    occurrenceStartsAt: z.string().datetime(),
    slots: z.array(lineupSlotSchema).max(30),
    version: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const ids = body.slots.map((slot) => slot.userId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate_lineup_user', path: ['slots'] });
    }
  });

/** Lineup from `GET` or `PUT /schedule/teams/:teamId/lineup`. */
export const lineupResponseSchema = z
  .object({
    eventId: z.string().min(1),
    occurrenceStartsAt: z.string().min(1),
    slots: z.array(lineupSlotSchema),
    /** Send this back when saving. Omitted when nothing is stored, or for a lineup saved before versions. */
    version: z.number().int().min(1).optional(),
  })
  .strict();

/** One driver's seats on an event date. */
export const carpoolOfferSchema = z
  .object({
    userId: z.string().min(1),
    seats: z.number().int().min(1).max(8),
    riderIds: z.array(z.string().min(1)),
  })
  .strict();

/** Query for rides on one occurrence. */
export const carpoolQuerySchema = z
  .object({
    eventId: z.string().min(1),
    occurrenceStartsAt: z.string().datetime(),
  })
  .strict();

/** Body for offering or clearing the caller's seats. `0` removes the offer. */
export const carpoolOfferBodySchema = z
  .object({
    eventId: z.string().min(1),
    occurrenceStartsAt: z.string().datetime(),
    seats: z.number().int().min(0).max(8),
  })
  .strict();

/** Body for claiming or leaving one driver's car. */
export const carpoolClaimBodySchema = z
  .object({
    eventId: z.string().min(1),
    occurrenceStartsAt: z.string().datetime(),
    driverUserId: z.string().min(1),
  })
  .strict();

/** Rides from `GET` or `PUT /schedule/teams/:teamId/carpool`. */
export const carpoolResponseSchema = z
  .object({
    eventId: z.string().min(1),
    occurrenceStartsAt: z.string().min(1),
    offers: z.array(carpoolOfferSchema),
  })
  .strict();

/** Body for proposing a game to another club. */
export const proposeFixtureBodySchema = z
  .object({
    teamId: z.string().min(1),
  })
  .strict();

/** Shared start and venue, used when accepting or editing a fixture. */
const fixtureFactsShape = {
  startsAt: z.string().datetime().optional(),
  endsAt: z.union([z.string().datetime(), z.null()]).optional(),
  location: z.union([z.string().max(500), z.null()]).optional(),
  latitude: z.union([latitudeSchema, z.null()]).optional(),
  longitude: z.union([longitudeSchema, z.null()]).optional(),
};

/** Body for accepting a proposed fixture onto a new or existing game. */
export const acceptFixtureBodySchema = z
  .object({
    eventId: z.string().min(1).optional(),
    ...fixtureFactsShape,
  })
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' });

/** Body for changing the shared start or venue. */
export const updateFixtureBodySchema = z
  .object(fixtureFactsShape)
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' })
  .refine((body) => Object.keys(body).length > 0, { message: 'invalid_body' });

/** One shared game from the fixture routes. */
export const fixtureSchema = z
  .object({
    fixtureId: z.string().min(1),
    status: fixtureStatusSchema,
    startsAt: z.string().min(1),
    endsAt: z.string().min(1).optional(),
    location: z.string().optional(),
    latitude: latitudeSchema.optional(),
    longitude: longitudeSchema.optional(),
    homeName: z.string().min(1),
    awayName: z.string().min(1),
    homeTeamId: z.string().min(1).optional(),
    awayTeamId: z.string().min(1).optional(),
    homeEventId: z.string().min(1).optional(),
    awayEventId: z.string().min(1).optional(),
    proposerTeamId: z.string().min(1),
    inviteeTeamId: z.string().min(1),
    sport: z.string().min(1).max(40).optional(),
    chatId: z.string().min(1).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict()
  .refine(hasPairedCoordinates, { message: 'coordinates_incomplete' });

/** `GET /schedule/teams/:teamId/fixtures`. */
export const fixtureListSchema = z
  .object({
    teamId: z.string().min(1),
    fixtures: z.array(fixtureSchema),
  })
  .strict();

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

/** `GET /schedule/feed` and `POST /schedule/feed/rotate`: the caller's private calendar link. */
export const calendarFeedSchema = z
  .object({
    /** `https://` link for Google Calendar and Outlook. */
    url: httpsUrlSchema,
    /** `webcal://` link that Apple Calendar subscribes to. */
    webcalUrl: webcalUrlSchema,
  })
  .strict();

/** Inferred type for {@link calendarFeedSchema}. */
export type CalendarFeed = z.infer<typeof calendarFeedSchema>;

/** Inferred type for {@link recurrenceRuleSchema}. */
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

/** Inferred type for {@link createEventBodySchema}. */
export type CreateEventBody = z.infer<typeof createEventBodySchema>;

/** Inferred type for {@link updateEventBodySchema}. */
export type UpdateEventBody = z.infer<typeof updateEventBodySchema>;

/** Inferred type for {@link occurrenceTargetSchema}. */
export type OccurrenceTarget = z.infer<typeof occurrenceTargetSchema>;

/** Inferred type for {@link exceptionEventBodySchema}. */
export type ExceptionEventBody = z.infer<typeof exceptionEventBodySchema>;

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

/** Inferred type for {@link lineupSlotSchema}. */
export type LineupSlot = z.infer<typeof lineupSlotSchema>;

/** Inferred type for {@link lineupQuerySchema}. */
export type LineupQuery = z.infer<typeof lineupQuerySchema>;

/** Inferred type for {@link lineupBodySchema}. */
export type LineupBody = z.infer<typeof lineupBodySchema>;

/** Inferred type for {@link lineupResponseSchema}. */
export type LineupResponse = z.infer<typeof lineupResponseSchema>;

/** Inferred type for {@link carpoolOfferSchema}. */
export type CarpoolOffer = z.infer<typeof carpoolOfferSchema>;

/** Inferred type for {@link carpoolQuerySchema}. */
export type CarpoolQuery = z.infer<typeof carpoolQuerySchema>;

/** Inferred type for {@link carpoolOfferBodySchema}. */
export type CarpoolOfferBody = z.infer<typeof carpoolOfferBodySchema>;

/** Inferred type for {@link carpoolClaimBodySchema}. */
export type CarpoolClaimBody = z.infer<typeof carpoolClaimBodySchema>;

/** Inferred type for {@link carpoolResponseSchema}. */
export type CarpoolResponse = z.infer<typeof carpoolResponseSchema>;

/** Inferred type for {@link proposeFixtureBodySchema}. */
export type ProposeFixtureBody = z.infer<typeof proposeFixtureBodySchema>;

/** Inferred type for {@link acceptFixtureBodySchema}. */
export type AcceptFixtureBody = z.infer<typeof acceptFixtureBodySchema>;

/** Inferred type for {@link updateFixtureBodySchema}. */
export type UpdateFixtureBody = z.infer<typeof updateFixtureBodySchema>;

/** Inferred type for {@link fixtureSchema}. */
export type Fixture = z.infer<typeof fixtureSchema>;

/** Inferred type for {@link fixtureListSchema}. */
export type FixtureList = z.infer<typeof fixtureListSchema>;
