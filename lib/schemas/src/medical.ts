/**
 * Emergency and medical information. Free on every plan.
 */

import { displayNameSchema } from './display-name.js';
import { accountKindSchema } from './enums.js';
import { phoneNumberSchema } from './phone.js';
import { z } from './zod.js';

/** Most emergency contacts one person keeps. */
export const MAX_EMERGENCY_CONTACTS = 4;

const note = z.string().trim().max(1000);

/** Someone to call. */
export const emergencyContactSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: phoneNumberSchema,
    relation: z.string().trim().max(60).optional(),
  })
  .strict();

/** Body for `PUT /identity/medical/:userId`. Replaces the whole record. */
export const medicalInfoBodySchema = z
  .object({
    allergies: note.optional(),
    conditions: note.optional(),
    medications: note.optional(),
    notes: note.optional(),
    insurance: z.string().trim().max(200).optional(),
    emergencyContacts: z.array(emergencyContactSchema).max(MAX_EMERGENCY_CONTACTS),
  })
  .strict();

/** A stored record as returned to someone allowed to read it. */
export const medicalInfoSchema = medicalInfoBodySchema
  .extend({
    userId: z.string().min(1),
    updatedAt: z.string().min(1).optional(),
  })
  .strict();

/** One person the caller manages emergency info for: themselves or a child. */
export const medicalPersonSchema = z
  .object({
    userId: z.string().min(1),
    displayName: displayNameSchema,
    accountKind: accountKindSchema,
    /** A minor's info is kept by their guardians; the minor can read it. */
    canEdit: z.boolean(),
    info: medicalInfoSchema,
  })
  .strict();

/** `GET /identity/medical`. */
export const medicalPeopleSchema = z
  .object({
    people: z.array(medicalPersonSchema),
  })
  .strict();

/** `GET /teams/:teamId/members/:userId/medical`: the record plus the member's guardians to call. */
export const memberMedicalSchema = z
  .object({
    info: medicalInfoSchema,
    guardians: z.array(
      z
        .object({
          userId: z.string().min(1),
          displayName: displayNameSchema,
          phoneNumber: phoneNumberSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

/** Inferred type for {@link memberMedicalSchema}. */
export type MemberMedical = z.infer<typeof memberMedicalSchema>;

/** Inferred type for {@link emergencyContactSchema}. */
export type EmergencyContact = z.infer<typeof emergencyContactSchema>;

/** Inferred type for {@link medicalInfoBodySchema}. */
export type MedicalInfoBody = z.infer<typeof medicalInfoBodySchema>;

/** Inferred type for {@link medicalInfoSchema}. */
export type MedicalInfo = z.infer<typeof medicalInfoSchema>;

/** Inferred type for {@link medicalPersonSchema}. */
export type MedicalPerson = z.infer<typeof medicalPersonSchema>;

/** Inferred type for {@link medicalPeopleSchema}. */
export type MedicalPeople = z.infer<typeof medicalPeopleSchema>;
