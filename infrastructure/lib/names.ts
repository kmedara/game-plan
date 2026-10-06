/**
 * Resource names shared with the Cloud Development Kit (CDK) app.
 *
 * Areas are listed in TypeScript so the construct graph stays typed. They are
 * checked against `config/resources.json` so the local proxy and the cloud stack cannot
 * drift apart.
 */

import resources from '../../config/resources.json';

/** Canonical area list used by the CDK constructs. */
const areas = [
  'identity',
  'teams',
  'schedule',
  'chat',
  'media',
  'socket',
  'fanout',
] as const;

/** One product area, and therefore one deployable Lambda. */
export type Area = (typeof areas)[number];

/** Area list loaded from the shared JSON config. */
const jsonAreas: readonly string[] = resources.areas;

if (
  jsonAreas.length !== areas.length ||
  jsonAreas.some((area, index) => area !== areas[index])
) {
  throw new Error('config/resources.json areas do not match the function list');
}

/**
 * Area ids that match `config/resources.json` and the local proxy prefixes.
 */
export const AREAS: readonly Area[] = areas;

/** Name of the single Amazon DynamoDB table. */
export const TABLE_NAME = resources.tableName;

/** Global Secondary Index (GSI) name for exact-email lookups. */
export const EMAIL_INDEX = resources.emailIndex;

/** Global Secondary Index (GSI) name for WebSocket connection lookups. */
export const CONNECTION_INDEX = resources.connectionIndex;
