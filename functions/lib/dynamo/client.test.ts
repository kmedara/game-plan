/**
 * Unit tests for the DynamoDB document client factory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDynamoDBClient, mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn((client: unknown) => ({ docClientFor: client }));
  const mockDynamoDBClient = vi.fn((config: unknown) => ({ config }));
  return { mockDynamoDBClient, mockFrom };
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: mockDynamoDBClient,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: mockFrom,
  },
}));

const { getDocClient, resetDocClient } = await import('./client.js');

describe('getDocClient', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetDocClient();
    mockDynamoDBClient.mockClear();
    mockFrom.mockClear();
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
});
