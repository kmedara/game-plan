/**
 * Messages people send to GamePlan support from the app.
 */

import { z } from './zod.js';

/** Body for `POST /identity/support`. */
export const supportRequestBodySchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(5000),
  })
  .strict();

/** Inferred type for {@link supportRequestBodySchema}. */
export type SupportRequestBody = z.infer<typeof supportRequestBodySchema>;
