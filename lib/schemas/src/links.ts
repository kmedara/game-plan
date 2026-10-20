/**
 * Link fields. A link a person can type, or one the app opens, must not carry
 * a `javascript:` or `data:` URL into the page.
 */

import { z } from './zod.js';

/**
 * A URL string limited to the given schemes.
 *
 * @param schemes - Allowed protocols, with the trailing colon (`https:`).
 * @returns A string schema that rejects any other scheme.
 */
export const linkSchema = (schemes: readonly string[]) =>
  z
    .string()
    .url()
    .refine((value) => schemes.includes(new URL(value).protocol), {
      message: `Must start with ${schemes.map((scheme) => `${scheme}//`).join(' or ')}`,
    });

/** An `https://` link: the only kind of web link the app opens. */
export const httpsUrlSchema = linkSchema(['https:']);

/** A `webcal://` calendar subscription link. */
export const webcalUrlSchema = linkSchema(['webcal:']);
