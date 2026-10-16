/**
 * Contact phone validation shared by identity and teammate profiles.
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { z } from './zod.js';

/**
 * Parses a contact phone into E.164.
 *
 * Numbers without a leading `+` are read as US numbers.
 *
 * @param value - The raw phone field.
 * @returns The E.164 number, or undefined when it is not a valid phone.
 */
export const toE164Phone = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = parsePhoneNumberFromString(trimmed, trimmed.startsWith('+') ? undefined : 'US');
  if (parsed === undefined || !parsed.isValid()) return undefined;
  return parsed.number;
};

/** Contact phone shown on a profile. Stored callers should keep the E.164 form. */
export const phoneNumberSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (toE164Phone(value) !== undefined) return;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number' });
  });
