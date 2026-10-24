/**
 * Shared display-name wire rule.
 */

import { z } from './zod.js';

/** Profile display name shown on people, messages, and roster rows. */
export const displayNameSchema = z.string().min(1).max(100);

/** A first or last name. Short enough that `First Last` fits {@link displayNameSchema}. */
export const personNameSchema = z.string().trim().min(1).max(49);

/** Inferred type for {@link displayNameSchema}. */
export type DisplayName = z.infer<typeof displayNameSchema>;
