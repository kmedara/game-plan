/**
 * The website origin that links and redirects point at.
 */

/**
 * Reads `CLIENT_ORIGIN` without a trailing slash.
 *
 * @returns The website origin, or the local dev site when unset.
 */
export const clientOrigin = (): string =>
  (process.env.CLIENT_ORIGIN ?? 'http://localhost:4200').replace(/\/+$/u, '');
