/**
 * Per-person settings that follow the account across devices.
 */

import { z } from './zod.js';

/** Local hours the evening-before reminder may fire at. */
export const REMINDER_EVENING_HOURS = [17, 18, 19, 20, 21] as const;

/** Minutes before the start the second reminder may fire at. */
export const REMINDER_LEAD_MINUTES = [15, 30, 60, 120] as const;

/** Evening reminder used when a person has not chosen. */
export const DEFAULT_EVENING_HOUR = 18;

/** Lead time used when a person has not chosen. */
export const DEFAULT_LEAD_MINUTES = 60;

/** One of {@link REMINDER_EVENING_HOURS}. */
const eveningHourSchema = z.union([z.literal(17), z.literal(18), z.literal(19), z.literal(20), z.literal(21)]);

/** One of {@link REMINDER_LEAD_MINUTES}. */
const leadMinutesSchema = z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]);

/** `GET /identity/me/preferences`. `null` turns a reminder off. */
export const preferencesSchema = z
  .object({
    reminderEveningHour: eveningHourSchema.nullable(),
    reminderLeadMinutes: leadMinutesSchema.nullable(),
  })
  .strict();

/** Inferred type for {@link preferencesSchema}. */
export type Preferences = z.infer<typeof preferencesSchema>;

/** Body for `PATCH /identity/me/preferences`. Omitted fields stay as they are. */
export const updatePreferencesBodySchema = preferencesSchema.partial().strict();

/** Inferred type for {@link updatePreferencesBodySchema}. */
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesBodySchema>;
