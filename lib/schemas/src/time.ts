/**
 * Time-zone wire contracts.
 */

import { z } from "./zod.js";

/** IANA-style time zone id such as `America/New_York`. */
export const timeZoneSchema = z
  .string({
    required_error: "Timezone is required",
  })
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z_]+)+$/, {
    message: "Incorrect timezone format, must be an IANA timezone id",
  });

/** Inferred type for {@link timeZoneSchema}. */
export type TimeZone = z.infer<typeof timeZoneSchema>;
