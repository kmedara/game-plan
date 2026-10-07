/**
 * Shared display-name wire rule.
 */

import { z } from './zod.js';

/** Profile display name shown on people, messages, and roster rows. */
export const displayNameSchema = z.string().min(1).max(100);

/** Inferred type for {@link displayNameSchema}. */
export type DisplayName = z.infer<typeof displayNameSchema>;
