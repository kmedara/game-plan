/**
 * Unit tests for the field-level update builder.
 */

import { describe, expect, it } from 'vitest';
import { TABLE_NAME } from '../names.js';
import { fieldUpdate } from './field-update.js';
import { TABLE_PK, TABLE_SK } from './keys.js';

describe('fieldUpdate', () => {
  it('sets defined fields, removes undefined ones, and requires the row', () => {
    expect(fieldUpdate('TEAM#t1', 'MEMBER#u1', { displayName: 'Ada King', firstName: 'Ada', lastName: undefined })).toEqual({
      TableName: TABLE_NAME,
      Key: { [TABLE_PK]: 'TEAM#t1', [TABLE_SK]: 'MEMBER#u1' },
      UpdateExpression: 'SET #f0 = :f0, #f1 = :f1 REMOVE #f2',
      ConditionExpression: 'attribute_exists(#pk)',
      ExpressionAttributeNames: { '#pk': TABLE_PK, '#f0': 'displayName', '#f1': 'firstName', '#f2': 'lastName' },
      ExpressionAttributeValues: { ':f0': 'Ada King', ':f1': 'Ada' },
    });
  });

  it('omits the value map when every field is removed', () => {
    const update = fieldUpdate('TEAM#t1', 'MEMBER#u1', { positions: undefined });
    expect(update.UpdateExpression).toBe('REMOVE #f0');
    expect(update).not.toHaveProperty('ExpressionAttributeValues');
  });

  it('checks the read version and stores the next one', () => {
    const checked = fieldUpdate('TEAM#t1', 'EVT#e1', { notes: 'x' }, { version: { read: 3 } });
    expect(checked.UpdateExpression).toBe('SET #f0 = :f0, #version = :nextVersion');
    expect(checked.ConditionExpression).toBe('attribute_exists(#pk) AND #version = :version');
    expect(checked.ExpressionAttributeValues).toMatchObject({ ':version': 3, ':nextVersion': 4 });

    const unversioned = fieldUpdate('TEAM#t1', 'EVT#e1', { notes: 'x' }, { version: { read: undefined } });
    expect(unversioned.ConditionExpression).toBe('attribute_exists(#pk) AND attribute_not_exists(#version)');
    expect(unversioned.ExpressionAttributeValues).toMatchObject({ ':nextVersion': 1 });
  });

  it('appends a value once and bumps the version without checking it', () => {
    const update = fieldUpdate(
      'TEAM#t1',
      'EVT#e1',
      { updatedAt: 'now' },
      { appendUnique: { field: 'exdates', value: 'd1' }, version: 'bump' },
    );
    expect(update.UpdateExpression).toBe(
      'SET #f0 = :f0, #list = list_append(if_not_exists(#list, :empty), :items) ADD #version :one',
    );
    expect(update.ConditionExpression).toBe('attribute_exists(#pk) AND NOT contains(#list, :item)');
    expect(update.ExpressionAttributeNames).toMatchObject({ '#list': 'exdates', '#version': 'version' });
    expect(update.ExpressionAttributeValues).toMatchObject({ ':item': 'd1', ':items': ['d1'], ':empty': [], ':one': 1 });
  });

  it('refuses an update with no fields', () => {
    expect(() => fieldUpdate('TEAM#t1', 'MEMBER#u1', {})).toThrow('no_fields');
  });
});
