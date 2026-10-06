/**
 * Shared resource names for the local Node processes.
 *
 * Values come from `config/resources.json` so the Cloud Development Kit (CDK) app and the
 * local proxy stay on the same table name, indexes, and ports.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Shape of `config/resources.json`. */
type Resources = {
  areas: [
    'identity',
    'teams',
    'schedule',
    'chat',
    'media',
    'places',
    'socket',
    'fanout',
  ];
  tableName: string;
  emailIndex: string;
  connectionIndex: string;
  proxyPort: number;
  firstAreaPort: number;
};

/** Parsed resource constants from the repository config file. */
const resources = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../config/resources.json', import.meta.url)), 'utf8'),
) as Resources;

/**
 * Area ids that match the Lambda functions and the local proxy prefixes.
 */
export const AREAS = resources.areas;

/** One product area, and therefore one deployable Lambda. */
export type Area = (typeof AREAS)[number];

/** Name of the single Amazon DynamoDB table. */
export const TABLE_NAME = resources.tableName;

/**
 * Global Secondary Index (GSI) for an exact-email lookup.
 *
 * The profile partition cannot be queried by email alone.
 */
export const EMAIL_INDEX = resources.emailIndex;

/**
 * Global Secondary Index (GSI) keyed by the WebSocket connection id.
 *
 * `$disconnect` arrives with a connection id and has to find the user item.
 */
export const CONNECTION_INDEX = resources.connectionIndex;

/** Port of the local reverse proxy that fronts every area process. */
export const PROXY_PORT = resources.proxyPort;

/**
 * Returns the loopback port for a local area process.
 *
 * @param area - The product area whose process should listen.
 * @returns The TCP port for that area.
 */
export const areaPort = (area: Area): number =>
  resources.firstAreaPort + AREAS.indexOf(area);

/**
 * Maps a request path to the local process that owns that prefix.
 *
 * @param path - A raw URL path, optionally with a query string.
 * @returns The area port, or `undefined` when no area matches.
 */
export const portForPath = (path: string): number | undefined => {
  const pathname = path.split('?')[0] || '/';
  const area = AREAS.find(
    (name) => pathname === `/${name}` || pathname.startsWith(`/${name}/`),
  );
  return area === undefined ? undefined : areaPort(area);
};
