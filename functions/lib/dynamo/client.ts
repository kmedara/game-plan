/**
 * Document client for the single product DynamoDB table.
 *
 * Points at DynamoDB Local when `DYNAMODB_ENDPOINT` is set so laptop work does
 * not need a cloud deploy.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  type ServiceInputTypes,
  type ServiceOutputTypes,
} from '@aws-sdk/lib-dynamodb';
import type { InitializeMiddleware } from '@smithy/types';
import { TABLE_PK, TABLE_SK } from './keys.js';

/** Cached document client for warm Lambda invocations and local processes. */
let docClient: DynamoDBDocumentClient | undefined;

/** Capacity numbers DynamoDB returns for a table or one index. */
type CapacityUnits = {
  CapacityUnits?: number;
  ReadCapacityUnits?: number;
  WriteCapacityUnits?: number;
};

/** One `ConsumedCapacity` entry, including the per-index breakdown. */
type ConsumedCapacity = CapacityUnits & {
  TableName?: string;
  GlobalSecondaryIndexes?: Record<string, CapacityUnits>;
};

/** Fields this middleware reads. Other command input is left untouched. */
type CapacityInput = {
  ReturnConsumedCapacity?: string;
  TableName?: string;
  IndexName?: string;
  Key?: Record<string, unknown>;
  Item?: Record<string, unknown>;
};

/** Item commands whose key identifies one row. Queries are logged without keys. */
const ITEM_COMMAND = /^(Get|Put|Update|Delete)/;

/**
 * Asks DynamoDB for per-index consumed capacity and logs the response.
 *
 * `ReturnConsumedCapacity` is discarded unless something reads it. One JSON
 * line per entry is enough to see which call was expensive. Query attribute
 * values are omitted because an email-index lookup would log the address.
 * A `Put` stores `PK` and `SK` on the item; the other item commands use `Key`.
 *
 * @param next - The next handler in the document-client stack.
 * @param context - Command metadata. `commandName` is the SDK command.
 * @returns A handler that sets the request flag and logs capacity when present.
 */
export const consumedCapacityMiddleware: InitializeMiddleware<ServiceInputTypes, ServiceOutputTypes> =
  (next, context) => async (args) => {
    const input = args.input as CapacityInput;
    input.ReturnConsumedCapacity = 'INDEXES';
    const result = await next(args);
    const consumed = (result.output as { ConsumedCapacity?: ConsumedCapacity | ConsumedCapacity[] })
      .ConsumedCapacity;
    if (consumed === undefined) return result;
    const entries = Array.isArray(consumed) ? consumed : [consumed];
    for (const entry of entries) {
      console.info(JSON.stringify(capacityLine(context.commandName, input, entry)));
    }
    return result;
  };

/**
 * Builds one capacity log line.
 *
 * @param commandName - The SDK command, such as `QueryCommand`.
 * @param input - The command input, already flagged for capacity.
 * @param entry - One consumed-capacity entry from the response.
 * @returns A JSON-ready log object. Query values are not copied.
 */
const capacityLine = (
  commandName: string | undefined,
  input: CapacityInput,
  entry: ConsumedCapacity,
): Record<string, unknown> => {
  const line: Record<string, unknown> = {
    msg: 'dynamodb_capacity',
    op: commandName,
    table: entry.TableName ?? input.TableName,
    ...unitFields(entry),
  };
  if (input.IndexName !== undefined) line.index = input.IndexName;
  if (entry.GlobalSecondaryIndexes !== undefined) {
    line.indexes = Object.fromEntries(
      Object.entries(entry.GlobalSecondaryIndexes).map(([name, units]) => [
        name,
        unitFields(units),
      ]),
    );
  }
  if (commandName !== undefined && ITEM_COMMAND.test(commandName)) {
    const key = input.Key ?? input.Item;
    const pk = key?.[TABLE_PK];
    const sk = key?.[TABLE_SK];
    if (typeof pk === 'string') line.pk = pk;
    if (typeof sk === 'string') line.sk = sk;
  }
  return line;
};

/**
 * Copies present capacity numbers into log fields.
 *
 * @param units - A table or index capacity block.
 * @returns The numbers DynamoDB actually returned.
 */
const unitFields = (units: CapacityUnits): Record<string, number> => {
  const fields: Record<string, number> = {};
  if (units.CapacityUnits !== undefined) fields.capacityUnits = units.CapacityUnits;
  if (units.ReadCapacityUnits !== undefined) fields.readCapacityUnits = units.ReadCapacityUnits;
  if (units.WriteCapacityUnits !== undefined) fields.writeCapacityUnits = units.WriteCapacityUnits;
  return fields;
};

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
  docClient.middlewareStack.add(consumedCapacityMiddleware, {
    step: 'initialize',
    name: 'logConsumedCapacity',
  });

  return docClient;
};

/**
 * Clears the cached client. Used by tests that need a fresh configuration.
 */
export const resetDocClient = (): void => {
  docClient = undefined;
};
