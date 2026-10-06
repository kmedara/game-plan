/**
 * Root Cloud Development Kit (CDK) stack for the GamePlan product.
 */

import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Api } from './api';
import { Auth } from './auth';
import { Database } from './database';
import { Storage } from './storage';

/** Props for {@link GamePlanStack}. */
export type GamePlanStackProps = cdk.StackProps & {
  /** Browser origin allowed by Cross-Origin Resource Sharing (CORS) on the HTTP API. */
  corsOrigin: string;
  /** Cognito OAuth callback URLs (identity BFF). */
  callbackUrls: string[];
  /** Cognito OAuth logout URLs (website origins). */
  logoutUrls: string[];
  /** Optional Google / Apple / Facebook Hosted UI credentials. */
  social?: {
    googleClientId?: string;
    googleClientSecret?: string;
    facebookAppId?: string;
    facebookAppSecret?: string;
    appleClientId?: string;
    appleTeamId?: string;
    appleKeyId?: string;
    applePrivateKey?: string;
  };
};

/**
 * Wires Cognito, DynamoDB, S3, CloudFront, the HTTP API, and the WebSocket API into one stack.
 */
export class GamePlanStack extends cdk.Stack {
  /**
   * Creates the auth, database, storage, and API constructs.
   *
   * @param scope - The CDK app.
   * @param id - The stack id.
   * @param props - Stack environment and CORS origin.
   */
  constructor(scope: Construct, id: string, props: GamePlanStackProps) {
    super(scope, id, props);

    const auth = new Auth(this, 'Auth', {
      callbackUrls: props.callbackUrls,
      logoutUrls: props.logoutUrls,
      social: props.social,
    });
    const database = new Database(this, 'Database');
    const storage = new Storage(this, 'Storage', { corsOrigin: props.corsOrigin });

    new Api(this, 'Api', {
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      hostedUiDomain: auth.hostedUiDomain,
      authCallbackUrl: props.callbackUrls[0]!,
      table: database.table,
      mediaBucket: storage.mediaBucket,
      corsOrigin: props.corsOrigin,
    });
  }
}
