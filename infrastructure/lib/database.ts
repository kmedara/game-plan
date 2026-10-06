/**
 * Single-table Amazon DynamoDB design for the product.
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { CONNECTION_INDEX, EMAIL_INDEX, TABLE_NAME } from './names';

/**
 * One on-demand table. A query starts at `PK`. A Global Secondary Index (GSI) exists only when
 * the lookup cannot start there: exact email, and the WebSocket connection id on `$disconnect`.
 *
 * Both indexes project keys only; the caller then loads the base item. The `ttl` attribute lets
 * a connection row expire after a dropped phone leaves a stale socket.
 */
export class Database extends Construct {
  /** The product DynamoDB table. */
  public readonly table: dynamodb.Table;

  /**
   * Creates the table, indexes, and table-name output.
   *
   * @param scope - The parent CDK construct.
   * @param id - The construct id.
   */
  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.Table(this, 'Table', {
      tableName: TABLE_NAME,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    this.table.addGlobalSecondaryIndex({
      indexName: EMAIL_INDEX,
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: CONNECTION_INDEX,
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      exportName: 'GamePlanTableName',
    });
  }
}
