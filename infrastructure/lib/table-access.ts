/**
 * Partition-prefix grants for the single product table.
 *
 * Each function may touch only the key prefixes it uses. Identity and Access
 * Management (IAM) cannot limit a shared role to one caller's teams.
 */

import * as iam from 'aws-cdk-lib/aws-iam';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { CONNECTION_INDEX, EMAIL_INDEX } from './names';

/** `USER#<userId>` profile, membership, device, and socket rows. */
export const USER_PREFIX = 'USER#*';

/** `TEAM#<teamId>` roster, events, and RSVPs. */
export const TEAM_PREFIX = 'TEAM#*';

/** `CHAT#<chatId>` members and messages. */
export const CHAT_PREFIX = 'CHAT#*';

/** `TICKET#<id>` one-time WebSocket connect tickets. */
export const TICKET_PREFIX = 'TICKET#*';

/** `HANDOFF#<code>` one-time native sign-in handoff. */
export const HANDOFF_PREFIX = 'HANDOFF#*';

/** `INVITE#<code>` invite lookup by code. */
export const INVITE_PREFIX = 'INVITE#*';

/** `TEAM_DIR` name search for the team directory. */
export const DIRECTORY_KEY = 'TEAM_DIR';

/** `REMINDERS` due-time rows for schedule pushes. */
export const REMINDERS_KEY = 'REMINDERS';

/** `STRIPE_ACCOUNT#<accountId>` which team a connected Stripe account belongs to. */
export const STRIPE_ACCOUNT_PREFIX = 'STRIPE_ACCOUNT#*';

/** `FEED#<token>` which person a calendar feed link belongs to. */
export const FEED_PREFIX = 'FEED#*';

/** `STRIPE_CUSTOMER#<customerId>` which team a Stripe Billing customer pays for. */
export const STRIPE_CUSTOMER_PREFIX = 'STRIPE_CUSTOMER#*';

/** `PAYMENT_REMINDERS` dated rows for dues reminders. */
export const PAYMENT_REMINDERS_KEY = 'PAYMENT_REMINDERS';

/** Which rows a function may read or write. */
export type PartitionGrant = {
  /** Partition-key patterns for `GetItem` and `Query`. */
  read?: readonly string[];
  /** Partition-key patterns for `PutItem` and `DeleteItem`. */
  write?: readonly string[];
  /** Partition-key patterns for `DeleteItem` only. */
  remove?: readonly string[];
  /** Also allow `TransactWriteItems` on the write prefixes. */
  transact?: boolean;
  /** Query the exact-email index. Its key is an email, not a `USER#` prefix. */
  emailIndex?: boolean;
  /** Query the WebSocket connection index. */
  connectionIndex?: boolean;
};

/**
 * Allows item actions only when every partition key matches `prefixes`.
 *
 * `Null` rejects a call that omits the key. `ForAllValues` rejects a
 * transaction that mixes in a prefix outside the list. A plain `StringLike`
 * never matches this multi-value key, so it would deny every item action.
 *
 * @param fn - The function role to extend.
 * @param table - The product table.
 * @param actions - DynamoDB item actions.
 * @param prefixes - `dynamodb:LeadingKeys` patterns.
 */
const allowPrefixes = (
  fn: iam.IGrantable,
  table: dynamodb.ITable,
  actions: readonly string[],
  prefixes: readonly string[],
): void => {
  if (prefixes.length === 0) return;
  fn.grantPrincipal.addToPrincipalPolicy(
    new iam.PolicyStatement({
      actions: [...actions],
      resources: [table.tableArn],
      conditions: {
        'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': [...prefixes] },
        Null: { 'dynamodb:LeadingKeys': 'false' },
      },
    }),
  );
};

/**
 * Grants one function the table prefixes and indexes it uses.
 *
 * @param table - The product table.
 * @param fn - The function role to extend.
 * @param grant - Read prefixes, write prefixes, and optional indexes.
 */
export const grantPartitions = (
  table: dynamodb.ITable,
  fn: iam.IGrantable,
  grant: PartitionGrant,
): void => {
  allowPrefixes(fn, table, ['dynamodb:GetItem', 'dynamodb:Query'], grant.read ?? []);
  const writeActions = ['dynamodb:PutItem', 'dynamodb:DeleteItem'];
  if (grant.transact === true) writeActions.push('dynamodb:TransactWriteItems');
  allowPrefixes(fn, table, writeActions, grant.write ?? []);
  allowPrefixes(fn, table, ['dynamodb:DeleteItem'], grant.remove ?? []);

  if (grant.emailIndex === true) {
    fn.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${table.tableArn}/index/${EMAIL_INDEX}`],
      }),
    );
  }
  if (grant.connectionIndex === true) {
    fn.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query'],
        resources: [`${table.tableArn}/index/${CONNECTION_INDEX}`],
      }),
    );
  }
};
