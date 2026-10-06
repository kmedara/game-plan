/**
 * Creates the local Amazon DynamoDB table so day-to-day work matches the cloud key shape.
 *
 * The script is idempotent: it creates the table when missing, then enables the
 * time-to-live attribute named `ttl` when it is not already on.
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  DescribeTimeToLiveCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { CONNECTION_INDEX, EMAIL_INDEX, TABLE_NAME } from '../../functions/lib/names.js';

/** Client pointed at DynamoDB Local unless `DYNAMODB_ENDPOINT` overrides it. */
const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

/**
 * Checks whether the product table already exists on the local endpoint.
 *
 * @returns `true` when the table exists.
 */
const tableExists = async (): Promise<boolean> => {
  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return false;
    throw error;
  }
};

/**
 * Creates the on-demand table with the email and connection Global Secondary Indexes (GSIs).
 */
const createTable = async (): Promise<void> => {
  await client.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'email', AttributeType: 'S' },
        { AttributeName: 'connectionId', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: EMAIL_INDEX,
          KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'KEYS_ONLY' },
        },
        {
          IndexName: CONNECTION_INDEX,
          KeySchema: [{ AttributeName: 'connectionId', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'KEYS_ONLY' },
        },
      ],
    }),
  );
};

/**
 * Enables the `ttl` attribute so stale socket rows can expire.
 *
 * Skips the update when time-to-live is already enabled (common on container restart).
 */
const ensureTtl = async (): Promise<void> => {
  const status = await client.send(
    new DescribeTimeToLiveCommand({ TableName: TABLE_NAME }),
  );
  const timeToLiveStatus = status.TimeToLiveDescription?.TimeToLiveStatus;
  if (timeToLiveStatus === 'ENABLED' || timeToLiveStatus === 'ENABLING') {
    console.info(`ttl already ${timeToLiveStatus.toLowerCase()} on ${TABLE_NAME}`);
    return;
  }

  try {
    await client.send(
      new UpdateTimeToLiveCommand({
        TableName: TABLE_NAME,
        TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      }),
    );
    console.info(`ttl enabled on ${TABLE_NAME}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // DynamoDB Local can still race and report that TTL is already on.
    if (message.includes('TimeToLive is already enabled')) {
      console.info(`ttl already enabled on ${TABLE_NAME}`);
      return;
    }
    throw error;
  }
};

if (!(await tableExists())) {
  await createTable();
  console.info(`created ${TABLE_NAME}`);
} else {
  console.info(`${TABLE_NAME} already exists`);
}

await ensureTtl();
