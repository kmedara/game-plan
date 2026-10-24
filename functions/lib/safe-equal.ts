/**
 * Constant-time comparison for secrets.
 */

import { timingSafeEqual } from 'node:crypto';

/**
 * Compares two secrets without leaking where they first differ.
 *
 * A length mismatch returns early, which reveals only the length.
 *
 * @param left - One value; strings are compared as UTF-8.
 * @param right - The other value.
 * @returns `true` when both hold the same bytes.
 */
export const safeEqual = (left: string | Buffer, right: string | Buffer): boolean => {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  return leftBuf.length === rightBuf.length && timingSafeEqual(leftBuf, rightBuf);
};
