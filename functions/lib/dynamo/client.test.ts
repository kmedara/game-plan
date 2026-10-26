/**
 * Unit tests for the DynamoDB document client factory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDynamoDBClient, mockFrom, mockMiddlewareAdd } = vi.hoisted(() => {
  const mockMiddlewareAdd = vi.fn();
  const mockFrom = vi.fn((client: unknown) => ({
    docClientFor: client,
    middlewareStack: { add: mockMiddlewareAdd },
  }));
  const mockDynamoDBClient = vi.fn((config: unknown) => ({ config }));
  return { mockDynamoDBClient, mockFrom, mockMiddlewareAdd };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: mockDynamoDBClient,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: mockFrom,
  },
}));

const { consumedCapacityMiddleware, getDocClient, resetDocClient } = await import('./client.js');

describe('getDocClient', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetDocClient();
    mockDynamoDBClient.mockClear();
    mockFrom.mockClear();
    mockMiddlewareAdd.mockClear();
    process.env = { ...envBackup };
    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = envBackup;
    resetDocClient();
  });

  it('caches the document client across calls', () => {
    const first = getDocClient();
    const second = getDocClient();

    expect(first).toBe(second);
    expect(mockDynamoDBClient).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('uses us-east-1 when no region environment variables are set', () => {
    getDocClient();

    expect(mockDynamoDBClient).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1' }),
    );
  });

  it('prefers AWS_REGION over AWS_DEFAULT_REGION', () => {
    process.env.AWS_DEFAULT_REGION = 'eu-west-1';
    process.env.AWS_REGION = 'ap-southeast-2';

    getDocClient();

    expect(mockDynamoDBClient).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'ap-southeast-2' }),
    );
  });

  it('falls back to AWS_DEFAULT_REGION when AWS_REGION is unset', () => {
    process.env.AWS_DEFAULT_REGION = 'eu-central-1';

    getDocClient();

    expect(mockDynamoDBClient).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'eu-central-1' }),
    );
  });

  it('configures a local endpoint and credentials when DYNAMODB_ENDPOINT is set', () => {
    process.env.DYNAMODB_ENDPOINT = ' http://localhost:8000 ';

    getDocClient();

    expect(mockDynamoDBClient).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://localhost:8000',
        credentials: {
          accessKeyId: 'local',
          secretAccessKey: 'local',
        },
      }),
    );
    expect(mockFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        marshallOptions: { removeUndefinedValues: true },
      }),
    );
  });

  it('uses explicit credentials from the environment for a local endpoint', () => {
    process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

    getDocClient();

    expect(mockDynamoDBClient).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
        },
      }),
    );
  });

  it('omits an explicit endpoint when DYNAMODB_ENDPOINT is unset', () => {
    getDocClient();

    const config = mockDynamoDBClient.mock.calls[0][0] as Record<string, unknown>;
    expect(config.endpoint).toBeUndefined();
    expect(config.credentials).toBeUndefined();
  });

  it('creates a fresh client after resetDocClient', () => {
    getDocClient();
    resetDocClient();
    getDocClient();

    expect(mockDynamoDBClient).toHaveBeenCalledTimes(2);
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('registers consumed-capacity logging on the document client', () => {
    getDocClient();

    expect(mockMiddlewareAdd).toHaveBeenCalledTimes(1);
    expect(mockMiddlewareAdd).toHaveBeenCalledWith(consumedCapacityMiddleware, {
      step: 'initialize',
      name: 'logConsumedCapacity',
    });
  });
});

describe('consumedCapacityMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for index capacity and logs a query without its attribute values', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const input = {
      TableName: 'gameplan',
      IndexName: 'EmailIndex',
      ExpressionAttributeValues: { ':email': 'person@example.com' },
      ReturnConsumedCapacity: undefined as string | undefined,
    };
    const next = vi.fn(async () => ({
      output: {
        ConsumedCapacity: {
          TableName: 'gameplan',
          CapacityUnits: 1,
          ReadCapacityUnits: 1,
          GlobalSecondaryIndexes: {
            EmailIndex: { CapacityUnits: 0.5, ReadCapacityUnits: 0.5 },
          },
        },
      },
    }));

    await consumedCapacityMiddleware(next as never, { commandName: 'QueryCommand' })({
      input,
    } as never);

    expect(input.ReturnConsumedCapacity).toBe('INDEXES');
    expect(info).toHaveBeenCalledTimes(1);
    const line = info.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      msg: 'dynamodb_capacity',
      op: 'QueryCommand',
      table: 'gameplan',
      index: 'EmailIndex',
      capacityUnits: 1,
      readCapacityUnits: 1,
      indexes: {
        EmailIndex: { capacityUnits: 0.5, readCapacityUnits: 0.5 },
      },
    });
    expect(line).not.toContain('person@example.com');
  });

  it('logs the item key for a get and skips the line when capacity is absent', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const input = { TableName: 'gameplan', Key: { PK: 'USER#1', SK: 'PROFILE' } };
    const next = vi.fn(async () => ({
      output: {
        ConsumedCapacity: { TableName: 'gameplan', ReadCapacityUnits: 0.5 },
      },
    }));

    await consumedCapacityMiddleware(next as never, { commandName: 'GetCommand' })({
      input,
    } as never);

    expect(JSON.parse(info.mock.calls[0]?.[0] as string)).toEqual({
      msg: 'dynamodb_capacity',
      op: 'GetCommand',
      table: 'gameplan',
      readCapacityUnits: 0.5,
      pk: 'USER#1',
      sk: 'PROFILE',
    });

    info.mockClear();
    await consumedCapacityMiddleware(
      (async () => ({ output: {} })) as never,
      { commandName: 'GetCommand' },
    )({ input: { Key: { PK: 'USER#1', SK: 'PROFILE' } } } as never);
    expect(info).not.toHaveBeenCalled();
  });

  it('logs one line per transaction entry and reads a put key from the item', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const put = { TableName: 'gameplan', Item: { PK: 'TEAM#1', SK: 'META', name: 'A' } };

    await consumedCapacityMiddleware(
      (async () => ({
        output: {
          ConsumedCapacity: {
            TableName: 'gameplan',
            WriteCapacityUnits: 1,
          },
        },
      })) as never,
      { commandName: 'PutCommand' },
    )({ input: put } as never);

    expect(JSON.parse(info.mock.calls[0]?.[0] as string)).toMatchObject({
      op: 'PutCommand',
      pk: 'TEAM#1',
      sk: 'META',
      writeCapacityUnits: 1,
    });
    expect(info.mock.calls[0]?.[0]).not.toContain('"name"');

    info.mockClear();
    await consumedCapacityMiddleware(
      (async () => ({
        output: {
          ConsumedCapacity: [
            { TableName: 'gameplan', WriteCapacityUnits: 2 },
            { TableName: 'gameplan', WriteCapacityUnits: 2 },
          ],
        },
      })) as never,
      { commandName: 'TransactWriteCommand' },
    )({ input: {} } as never);

    expect(info).toHaveBeenCalledTimes(2);
    expect(JSON.parse(info.mock.calls[1]?.[0] as string)).toMatchObject({
      op: 'TransactWriteCommand',
      writeCapacityUnits: 2,
    });
  });
});
