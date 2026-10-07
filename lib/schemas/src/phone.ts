/**
 * Contact phone validation shared by identity and teammate profiles.
 */

import { z } from './zod.js';

/** Contact phone shown on a profile (digits and common separators). */
export const phoneNumberSchema = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^\+?[0-9()\-.\s]+$/, { message: 'Enter a valid phone number' });
