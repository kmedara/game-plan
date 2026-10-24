/**
 * Field-level updates: change only the named attributes of an existing row.
 *
 * Writing the whole row back after a read loses whatever another request
 * changed in between. An update that names only its own fields does not.
 */

import { TABLE_NAME } from '../names.js';
import { TABLE_PK, TABLE_SK } from './keys.js';

/** Update input for `UpdateCommand` or a `TransactWriteItems` `Update` entry. */
export type FieldUpdate = {
  TableName: string;
  Key: Record<string, string>;
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
};

/** Optional checks and list changes for {@link fieldUpdate}. */
export type FieldUpdateOptions = {
  /**
   * How the row's `version` attribute changes.
   *
   * `{ read }` is an optimistic check: the update fails unless the stored
   * version is still the one the caller read (`undefined` for a row written
   * before versions), and stores the next one. Use it when the new values were
   * worked out from the read. `'bump'` stores the next version without a
   * check, for a change that is safe to apply on top of any other, so a
   * checked write that read before it fails.
   */
  version?: { read: number | undefined } | 'bump';
  /**
   * Adds one string to a list attribute, creating the list when missing. The
   * update fails when the list already holds it.
   */
  appendUnique?: { field: string; value: string };
};

/**
 * Builds an update that sets each field to its value and removes each field
 * whose value is `undefined`. Other attributes are left as stored.
 *
 * The row must already exist, so a row deleted since it was read is not
 * brought back with only these fields.
 *
 * Placeholders follow a fixed scheme the in-memory test table reads: field
 * `n` is `#fn` / `:fn`, the version is `#version` with `:version` (read),
 * `:nextVersion`, or `:one` (bump), and an append is `#list` / `:item`.
 *
 * @param pk - The partition key value.
 * @param sk - The sort key value.
 * @param fields - Attributes to change. `undefined` removes one.
 * @param options - Version check or bump, and a list append.
 * @returns The update input.
 * @throws `no_fields` when there is nothing to change.
 */
export const fieldUpdate = (
  pk: string,
  sk: string,
  fields: Record<string, unknown>,
  options: FieldUpdateOptions = {},
): FieldUpdate => {
  const entries = Object.entries(fields);
  if (entries.length === 0 && options.appendUnique === undefined) throw new Error('no_fields');
  const names: Record<string, string> = { '#pk': TABLE_PK };
  const values: Record<string, unknown> = {};
  const set: string[] = [];
  const remove: string[] = [];
  const add: string[] = [];
  const conditions = ['attribute_exists(#pk)'];

  entries.forEach(([field, value], index) => {
    names[`#f${index}`] = field;
    if (value === undefined) {
      remove.push(`#f${index}`);
    } else {
      values[`:f${index}`] = value;
      set.push(`#f${index} = :f${index}`);
    }
  });

  if (options.appendUnique !== undefined) {
    names['#list'] = options.appendUnique.field;
    values[':item'] = options.appendUnique.value;
    values[':items'] = [options.appendUnique.value];
    values[':empty'] = [];
    set.push('#list = list_append(if_not_exists(#list, :empty), :items)');
    conditions.push('NOT contains(#list, :item)');
  }

  if (options.version === 'bump') {
    names['#version'] = 'version';
    values[':one'] = 1;
    add.push('#version :one');
  } else if (options.version !== undefined) {
    names['#version'] = 'version';
    const { read } = options.version;
    values[':nextVersion'] = (read ?? 0) + 1;
    set.push('#version = :nextVersion');
    if (read === undefined) {
      conditions.push('attribute_not_exists(#version)');
    } else {
      values[':version'] = read;
      conditions.push('#version = :version');
    }
  }

  return {
    TableName: TABLE_NAME,
    Key: { [TABLE_PK]: pk, [TABLE_SK]: sk },
    UpdateExpression: [
      ...(set.length > 0 ? [`SET ${set.join(', ')}`] : []),
      ...(remove.length > 0 ? [`REMOVE ${remove.join(', ')}`] : []),
      ...(add.length > 0 ? [`ADD ${add.join(', ')}`] : []),
    ].join(' '),
    ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length > 0 ? { ExpressionAttributeValues: values } : {}),
  };
};
