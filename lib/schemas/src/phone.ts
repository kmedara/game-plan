/**
 * Contact phone validation shared by identity and teammate profiles.
 */

import { toE164Phone } from '@gameplan/rules';
import { z } from './zod.js';

export { toE164Phone };

/** Contact phone shown on a profile. Stored callers should keep the E.164 form. */
export const phoneNumberSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (toE164Phone(value) !== undefined) return;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number' });
  });
