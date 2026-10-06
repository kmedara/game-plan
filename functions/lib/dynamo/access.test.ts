/**
 * Unit tests for DynamoDB access helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TABLE_NAME } from '../names.js';
import { TABLE_PK, TABLE_SK } from './keys.js';

const mockSend = vi.fn();

vi.mock('./client.js', () => ({
  getDocClient: () => ({ send: mockSend }),
  resetDocClient: vi.fn(),
}));

const {
  decodeCursor,
  encodeCursor,
  deleteItem,
  getItem,
  putItem,
  queryAll,
  queryBySkBetween,
  queryBySkPrefix,
  queryPage,
  queryPartition,
  transactWrite,
} = await import('./access.js');

describe('dynamo access', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  describe('encodeCursor / decodeCursor', () => {
    it('returns undefined for an undefined key', () => {
      expect(encodeCursor(undefined)).toBeUndefined();
    });

    it('round-trips a valid exclusive start key', () => {
      const key = { PK: 'USER#u1', SK: 'PROFILE' };
      const cursor = encodeCursor(key);
      expect(cursor).toBeTypeOf('string');
      expect(decodeCursor(cursor)).toEqual(key);
    });

    it('returns undefined for empty or invalid cursors', () => {
      expect(decodeCursor(undefined)).toBeUndefined();
      expect(decodeCursor('')).toBeUndefined();
      expect(decodeCursor('not-valid-base64url!!!')).toBeUndefined();
      const badJson = Buffer.from('not-json', 'utf8').toString('base64url');
      expect(decodeCursor(badJson)).toBeUndefined();
    });
  });

  it('loads an item by primary key', async () => {
    const item = { PK: 'USER#u1', SK: 'PROFILE', name: 'Ada' };
    mockSend.mockResolvedValueOnce({ Item: item });

    await expect(getItem('USER#u1', 'PROFILE')).resolves.toEqual(item);

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      TableName: TABLE_NAME,
      Key: { [TABLE_PK]: 'USER#u1', [TABLE_SK]: 'PROFILE' },
    });
  });

  it('returns undefined when getItem finds no row', async () => {
    mockSend.mockResolvedValueOnce({});

    await expect(getItem('USER#u1', 'PROFILE')).resolves.toBeUndefined();
  });

  it('puts an item without a condition', async () => {
    mockSend.mockResolvedValueOnce({});
    const item = { PK: 'USER#u1', SK: 'PROFILE' };

    await putItem(item);

    const input = mockSend.mock.calls[0][0].input;
    expect(input).toMatchObject({ TableName: TABLE_NAME, Item: item });
    expect(input.ConditionExpression).toBeUndefined();
  });

  it('puts an item with a condition expression', async () => {
    mockSend.mockResolvedValueOnce({});

    await putItem(
      { PK: 'USER#u1', SK: 'PROFILE' },
      {
        conditionExpression: 'attribute_not_exists(PK)',
        expressionAttributeNames: { '#pk': 'PK' },
        expressionAttributeValues: { ':v': 1 },
      },
    );

    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      TableName: TABLE_NAME,
      ConditionExpression: 'attribute_not_exists(PK)',
      ExpressionAttributeNames: { '#pk': 'PK' },
      ExpressionAttributeValues: { ':v': 1 },
    });
  });

  it('deletes an item by primary key', async () => {
    mockSend.mockResolvedValueOnce({});

    await deleteItem('TEAM#t1', 'META');

    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      TableName: TABLE_NAME,
      Key: { [TABLE_PK]: 'TEAM#t1', [TABLE_SK]: 'META' },
    });
  });

  it('runs a transact write', async () => {
    mockSend.mockResolvedValueOnce({});
    const transactItems = [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: { PK: 'A', SK: 'B' },
        },
      },
    ];

    await transactWrite(transactItems);

    expect(mockSend.mock.calls[0][0].input).toEqual({
      TransactItems: transactItems,
    });
  });

  it('pages queryAll until the partition is exhausted', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ PK: 'TEAM#t1', SK: 'A' }],
        LastEvaluatedKey: { PK: 'TEAM#t1', SK: 'A' },
      })
      .mockResolvedValueOnce({
        Items: [{ PK: 'TEAM#t1', SK: 'B' }],
      });

    const items = await queryAll({
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': TABLE_PK },
      ExpressionAttributeValues: { ':pk': 'TEAM#t1' },
    });

    expect(items).toEqual([
      { PK: 'TEAM#t1', SK: 'A' },
      { PK: 'TEAM#t1', SK: 'B' },
    ]);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
      PK: 'TEAM#t1',
      SK: 'A',
    });
  });

  it('treats missing Items in queryAll as an empty page', async () => {
    mockSend.mockResolvedValueOnce({});

    await expect(
      queryAll({ KeyConditionExpression: '#pk = :pk' }),
    ).resolves.toEqual([]);
  });

  it('returns an empty item list when DynamoDB omits Items', async () => {
    mockSend.mockResolvedValueOnce({});
    const page = await queryPage(
      {
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': TABLE_PK },
        ExpressionAttributeValues: { ':pk': 'TEAM#t1' },
      },
      { limit: 5 },
    );
    expect(page.items).toEqual([]);
    expect(page.cursor).toBeUndefined();
  });

  it('returns a single query page with an optional next cursor', async () => {
    const lastKey = { PK: 'TEAM#t1', SK: 'MSG#1' };
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'TEAM#t1', SK: 'MSG#0' }],
      LastEvaluatedKey: lastKey,
    });

    const startCursor = encodeCursor({ PK: 'TEAM#t1', SK: 'MSG#start' });
    const page = await queryPage<{ PK: string; SK: string }>(
      {
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': TABLE_PK },
        ExpressionAttributeValues: { ':pk': 'TEAM#t1' },
      },
      { limit: 10, cursor: startCursor },
    );

    expect(page.items).toEqual([{ PK: 'TEAM#t1', SK: 'MSG#0' }]);
    expect(page.cursor).toBe(encodeCursor(lastKey));
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      Limit: 10,
      ExclusiveStartKey: decodeCursor(startCursor),
    });
  });

  it('queries every item under a partition key', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'USER#u1', SK: 'PROFILE' }],
    });

    const items = await queryPartition('USER#u1');

    expect(items).toEqual([{ PK: 'USER#u1', SK: 'PROFILE' }]);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': TABLE_PK },
      ExpressionAttributeValues: { ':pk': 'USER#u1' },
    });
  });

  it('queries items by sort-key prefix', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await queryBySkPrefix('CHAT#c1', 'MSG#');

    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': TABLE_PK, '#sk': TABLE_SK },
      ExpressionAttributeValues: { ':pk': 'CHAT#c1', ':skPrefix': 'MSG#' },
    });
  });

  it('queries items by sort-key range', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    await queryBySkBetween('TEAM#t1', 'RSVP#lo', 'RSVP#hi');

    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :lo AND :hi',
      ExpressionAttributeNames: { '#pk': TABLE_PK, '#sk': TABLE_SK },
      ExpressionAttributeValues: {
        ':pk': 'TEAM#t1',
        ':lo': 'RSVP#lo',
        ':hi': 'RSVP#hi',
      },
    });
  });
});
