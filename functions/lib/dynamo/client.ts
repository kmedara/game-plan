/**
 * Document client for the single product DynamoDB table.
 *
 * Points at DynamoDB Local when `DYNAMODB_ENDPOINT` is set so laptop work does
 * not need a cloud deploy.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Cached document client for warm Lambda invocations and local processes. */
let docClient: DynamoDBDocumentClient | undefined;

/**
 * Returns a shared {@link DynamoDBDocumentClient}.
 *
 * @returns The document client for the product table.
 */
export const getDocClient = (): DynamoDBDocumentClient => {
  if (docClient !== undefined) return docClient;

  const endpoint = process.env.DYNAMODB_ENDPOINT?.trim();
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
    maxAttempts: 3,
    retryMode: 'adaptive',
    ...(endpoint
      ? {
          endpoint,
          // DynamoDB Local does not validate credentials, but the SDK still
          // requires a provider when an explicit endpoint is configured.
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
          },
        }
      : {}),
  });

  docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  return docClient;
};

/**
 * Clears the cached client. Used by tests that need a fresh configuration.
 */
export const resetDocClient = (): void => {
  docClient = undefined;
};
