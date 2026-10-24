/**
 * In-memory stand-in for `access.ts`, for tests only.
 *
 * Tests replace the access module with {@link memoryAccess} and seed or read
 * rows through {@link memoryTable}:
 *
 * ```ts
 * import { memoryTable } from '../../lib/dynamo/memory-table.js';
 * const { store, itemKey } = memoryTable;
 * vi.mock('../../lib/dynamo/access.js', async () => (await import('../../lib/dynamo/memory-table.js')).memoryAccess);
 * ```
 *
 * The table lives for one test file. Clear it in `beforeEach`.
 *
 * Queries return rows in sort-key order, as DynamoDB does. Conditional puts
 * honor `attribute_not_exists` and `#name = :value` (optimistic version
 * checks), field updates fail on a missing row, transactions check every
 * condition before writing anything, and a `contains(#name, :value)` filter
 * is applied. Global secondary indexes are not modeled.
 */

import { fieldUpdate, type FieldUpdate, type FieldUpdateOptions } from './field-update.js';
import { TABLE_PK, TABLE_SK } from './keys.js';

type Row = Record<string, unknown>;

type QueryInput = {
  KeyConditionExpression?: string;
  FilterExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
  ScanIndexForward?: boolean;
};

type TransactEntry = {
  Put?: {
    Item: Row;
    ConditionExpression?: string;
    ExpressionAttributeNames?: Record<string, string>;
    ExpressionAttributeValues?: Record<string, unknown>;
  };
  Delete?: { Key: Row };
  Update?: FieldUpdate;
};

const store = new Map<string, Row>();

const itemKey = (pk: string, sk: string): string => `${pk}\0${sk}`;

const keyOf = (row: Row): string => itemKey(String(row[TABLE_PK]), String(row[TABLE_SK]));

const failed = (name: string): Error => {
  const error = new Error(name);
  error.name = name;
  return error;
};

const mustNotExist = (condition: string | undefined): boolean =>
  condition?.includes('attribute_not_exists') === true;

/**
 * Checks a `#name = :value` condition against the stored row.
 *
 * @returns `false` when the condition names a field whose stored value differs.
 */
const equalityHolds = (
  existing: Row | undefined,
  condition: string | undefined,
  names: Record<string, string> = {},
  values: Record<string, unknown> = {},
): boolean => {
  const match = /(#\w+)\s*=\s*(:\w+)/.exec(condition ?? '');
  if (match === null) return true;
  if (existing === undefined) return false;
  return existing[names[match[1] ?? ''] ?? ''] === values[match[2] ?? ''];
};

/**
 * Works out the row a {@link FieldUpdate} would store, reading the fixed
 * placeholder scheme `fieldUpdate` documents.
 *
 * @returns The next row, or `undefined` when the update's condition fails.
 */
const updatedRow = (update: FieldUpdate): Row | undefined => {
  const existing = store.get(keyOf(update.Key));
  if (existing === undefined) return undefined;
  const names = update.ExpressionAttributeNames;
  const values = update.ExpressionAttributeValues ?? {};
  const next: Row = { ...existing };

  for (const [placeholder, field] of Object.entries(names)) {
    if (!placeholder.startsWith('#f')) continue;
    const value = values[`:${placeholder.slice(1)}`];
    if (value === undefined) delete next[field];
    else next[field] = value;
  }

  const list = names['#list'];
  if (list !== undefined) {
    const current = Array.isArray(existing[list]) ? (existing[list] as unknown[]) : [];
    if (current.includes(values[':item'])) return undefined;
    next[list] = [...current, values[':item']];
  }

  if (names['#version'] !== undefined) {
    const stored = existing.version;
    if (':one' in values) {
      next.version = (typeof stored === 'number' ? stored : 0) + 1;
    } else {
      const expected = values[':version'];
      if (expected === undefined ? stored !== undefined : stored !== expected) return undefined;
      next.version = values[':nextVersion'];
    }
  }
  return next;
};

/** Rows in one partition whose sort key passes `match`, in sort-key order. */
const partitionRows = (pk: string, match: (sk: string) => boolean): Row[] =>
  [...store.entries()]
    .flatMap(([key, row]) => {
      const [rowPk = '', rowSk = ''] = key.split('\0');
      return rowPk === pk && match(rowSk) ? [{ sk: rowSk, row }] : [];
    })
    .sort((left, right) => (left.sk < right.sk ? -1 : left.sk > right.sk ? 1 : 0))
    .map((entry) => entry.row);

/** Applies a `contains(#name, :value)` filter, the only form the code uses. */
const passesFilter = (row: Row, input: QueryInput): boolean => {
  const match = /contains\((#\w+),\s*(:\w+)\)/.exec(input.FilterExpression ?? '');
  if (match === null) return true;
  const field = input.ExpressionAttributeNames?.[match[1] ?? ''] ?? '';
  const needle = input.ExpressionAttributeValues?.[match[2] ?? ''];
  return typeof needle === 'string' && String(row[field] ?? '').includes(needle);
};

/** Rows a query input selects, honoring prefix, range, filter, and direction. */
const queryRows = (input: QueryInput): Row[] => {
  const values = input.ExpressionAttributeValues ?? {};
  const pk = String(values[':pk'] ?? '');
  const prefix = values[':skPrefix'];
  const lo = values[':lo'];
  const hi = values[':hi'];
  const rows = partitionRows(pk, (sk) => {
    if (typeof prefix === 'string' && !sk.startsWith(prefix)) return false;
    if (typeof lo === 'string' && sk < lo) return false;
    if (typeof hi === 'string' && sk > hi) return false;
    return true;
  }).filter((row) => passesFilter(row, input));
  return input.ScanIndexForward === false ? rows.reverse() : rows;
};

/** Drop-in replacement for every export of `access.ts`. */
export const memoryAccess = {
  getItem: async <T extends Row>(pk: string, sk: string): Promise<T | undefined> =>
    store.get(itemKey(pk, sk)) as T | undefined,
  putItem: async (
    item: Row,
    options: {
      conditionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: Record<string, unknown>;
    } = {},
  ): Promise<void> => {
    if (mustNotExist(options.conditionExpression) && store.has(keyOf(item))) {
      throw failed('ConditionalCheckFailedException');
    }
    const held = equalityHolds(
      store.get(keyOf(item)),
      options.conditionExpression,
      options.expressionAttributeNames,
      options.expressionAttributeValues,
    );
    if (!held) throw failed('ConditionalCheckFailedException');
    store.set(keyOf(item), item);
  },
  updateFields: async <T extends Row>(
    pk: string,
    sk: string,
    fields: Row,
    options: FieldUpdateOptions = {},
  ): Promise<T> => {
    const next = updatedRow(fieldUpdate(pk, sk, fields, options));
    if (next === undefined) throw failed('ConditionalCheckFailedException');
    store.set(itemKey(pk, sk), next);
    return next as T;
  },
  deleteItem: async (pk: string, sk: string): Promise<void> => {
    store.delete(itemKey(pk, sk));
  },
  incrementCounter: async (pk: string, sk: string, limit: number, ttl: number): Promise<number> => {
    const current = Number(store.get(itemKey(pk, sk))?.count ?? 0);
    if (current >= limit) throw failed('ConditionalCheckFailedException');
    store.set(itemKey(pk, sk), { [TABLE_PK]: pk, [TABLE_SK]: sk, count: current + 1, ttl });
    return current + 1;
  },
  transactWrite: async (items: readonly TransactEntry[]): Promise<void> => {
    for (const entry of items) {
      if (entry.Update !== undefined && updatedRow(entry.Update) === undefined) {
        throw failed('TransactionCanceledException');
      }
      if (entry.Put === undefined) continue;
      const { Item, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } = entry.Put;
      if (mustNotExist(ConditionExpression) && store.has(keyOf(Item))) {
        throw failed('TransactionCanceledException');
      }
      if (!equalityHolds(store.get(keyOf(Item)), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues)) {
        throw failed('TransactionCanceledException');
      }
    }
    for (const entry of items) {
      if (entry.Put !== undefined) store.set(keyOf(entry.Put.Item), entry.Put.Item);
      if (entry.Delete !== undefined) store.delete(keyOf(entry.Delete.Key));
      if (entry.Update !== undefined) store.set(keyOf(entry.Update.Key), updatedRow(entry.Update)!);
    }
  },
  queryAll: async <T extends Row>(input: QueryInput): Promise<T[]> => queryRows(input) as T[],
  queryPage: async <T extends Row>(
    input: QueryInput,
    options: { limit: number; cursor?: string },
  ): Promise<{ items: T[]; cursor?: string }> => {
    const rows = queryRows(input) as T[];
    const start = options.cursor !== undefined ? Number(options.cursor) : 0;
    const end = start + options.limit;
    return { items: rows.slice(start, end), ...(end < rows.length ? { cursor: String(end) } : {}) };
  },
  queryPartition: async <T extends Row>(pk: string): Promise<T[]> => partitionRows(pk, () => true) as T[],
  queryBySkPrefix: async <T extends Row>(pk: string, skPrefix: string): Promise<T[]> =>
    partitionRows(pk, (sk) => sk.startsWith(skPrefix)) as T[],
  queryBySkBetween: async <T extends Row>(pk: string, lo: string, hi: string): Promise<T[]> =>
    partitionRows(pk, (sk) => sk >= lo && sk <= hi) as T[],
  encodeCursor: (key: Row | undefined): string | undefined =>
    key === undefined ? undefined : Buffer.from(JSON.stringify(key), 'utf8').toString('base64url'),
  decodeCursor: (cursor?: string): Row | undefined =>
    cursor === undefined || cursor.length === 0
      ? undefined
      : (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Row),
};

/** The rows behind {@link memoryAccess}, for seeding and checking in tests. */
export const memoryTable = {
  /** Every row, keyed by {@link memoryTable.itemKey}. */
  store,
  itemKey,
  /** Stores a row under its own `PK` and `SK`. */
  put: (row: Row): void => {
    store.set(keyOf(row), row);
  },
  get: (pk: string, sk: string): Row | undefined => store.get(itemKey(pk, sk)),
  clear: (): void => store.clear(),
};
