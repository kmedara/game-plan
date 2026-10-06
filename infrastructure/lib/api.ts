/**
 * HTTP API and WebSocket API wiring for every product area Lambda.
 */

import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer, WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AREAS, type Area } from './names';
import { areaEntry, createAreaFunctions, createFunction } from './functions';

/** Inputs the API construct needs from the auth, database, and storage constructs. */
export type ApiProps = {
  /** Cognito user pool that issues access tokens for HTTP and WebSocket clients. */
  userPool: cognito.IUserPool;
  /** App client used by the website and the Capacitor apps. */
  userPoolClient: cognito.IUserPoolClient;
  /** Cognito Hosted UI domain (no scheme), for identity OAuth redirects. */
  hostedUiDomain: string;
  /** Absolute OAuth callback URL for the identity BFF. */
  authCallbackUrl: string;
  /** Single-table DynamoDB resource for user, team, schedule, and chat data. */
  table: dynamodb.Table;
  /** Private bucket that stores message file bytes. */
  mediaBucket: s3.IBucket;
  /** Browser origin allowed by Cross-Origin Resource Sharing (CORS). */
  corsOrigin: string;
};

/**
 * Areas whose HTTP routes stay open so register and login can run before a token exists.
 */
const PUBLIC_HTTP = new Set<Area>(['identity']);

/**
 * Areas that read and write the product DynamoDB table.
 *
 * Media stores device tokens on the user partition and signs S3 URLs.
 */
const TABLE_AREAS: readonly Area[] = [
  'identity',
  'teams',
  'schedule',
  'chat',
  'media',
  'socket',
  'fanout',
];

/**
 * HTTP API plus the WebSocket API. Each area is its own function.
 *
 * The gateway checks the Cognito access token. Team permissions are checked inside the
 * function later. WebSocket APIs have no Cognito authorizer, so `$connect` uses a Lambda
 * authorizer for the same token.
 */
export class Api extends Construct {
  /** Amazon API Gateway HTTP API that fronts the area Lambdas. */
  public readonly httpApi: apigwv2.HttpApi;

  /** Amazon API Gateway WebSocket API used for live delivery only. */
  public readonly webSocketApi: apigwv2.WebSocketApi;

  /**
   * Creates the HTTP routes, WebSocket routes, fan-out queue, and push topic.
   *
   * @param scope - The parent CDK construct.
   * @param id - The construct id.
   * @param props - Auth, table, media, and CORS inputs.
   */
  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const deadLetter = new sqs.Queue(this, 'FanoutDeadLetter', {
      queueName: 'gameplan-fanout-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const queue = new sqs.Queue(this, 'FanoutQueue', {
      queueName: 'gameplan-fanout',
      visibilityTimeout: cdk.Duration.seconds(60),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: deadLetter, maxReceiveCount: 5 },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const pushTopic = new sns.Topic(this, 'PushTopic', {
      topicName: 'gameplan-push',
    });

    const shared = { NODE_ENV: 'production', CLIENT_ORIGIN: props.corsOrigin };
    const tableEnv = { TABLE_NAME: props.table.tableName };
    const queueEnv = { FANOUT_QUEUE_URL: queue.queueUrl };
    const cognitoEnv = {
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
      COGNITO_HOSTED_UI_DOMAIN: props.hostedUiDomain,
      COGNITO_REGION: cdk.Stack.of(this).region,
      AUTH_CALLBACK_URL: props.authCallbackUrl,
      AUTH_DISABLED: 'false',
    };

    /**
     * Builds the environment map for one area Lambda.
     *
     * @param area - The product area whose variables are needed.
     * @returns Environment variables for that function.
     */
    const environmentFor = (area: Area): Record<string, string> => {
      switch (area) {
        case 'identity':
          return { ...shared, ...tableEnv, ...cognitoEnv };
        case 'teams':
        case 'socket':
          return { ...shared, ...tableEnv };
        case 'schedule':
        case 'chat':
          return { ...shared, ...tableEnv, ...queueEnv };
        case 'media':
          return {
            ...shared,
            ...tableEnv,
            MEDIA_BUCKET: props.mediaBucket.bucketName,
          };
        case 'places':
          return {
            ...shared,
            GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? '',
          };
        case 'fanout':
          return { ...shared, ...tableEnv, ...queueEnv, PUSH_TOPIC_ARN: pushTopic.topicArn };
        default: {
          const exhaustive: never = area;
          return exhaustive;
        }
      }
    };

    const functions = createAreaFunctions(this, environmentFor);

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'gameplan-http',
      createDefaultStage: true,
      corsPreflight: {
        allowCredentials: true,
        allowHeaders: ['Authorization', 'Content-Type', 'Cookie', 'X-Refresh-Delivery'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: [props.corsOrigin],
      },
    });

    const httpAuthorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', props.userPool, {
      userPoolClients: [props.userPoolClient],
      authorizerName: 'gameplan-cognito',
    });

    for (const area of AREAS) {
      const integration = new integrations.HttpLambdaIntegration(`${area}Http`, functions[area]);
      this.httpApi.addRoutes({
        path: `/${area}/health`,
        methods: [apigwv2.HttpMethod.GET],
        integration,
      });
      this.httpApi.addRoutes({
        path: `/${area}/{proxy+}`,
        methods: [apigwv2.HttpMethod.ANY],
        integration,
        ...(PUBLIC_HTTP.has(area) ? {} : { authorizer: httpAuthorizer }),
      });
    }

    const socketAuthorizerFn = createFunction(
      this,
      'socket-authorizer',
      areaEntry('socket', 'authorize.ts'),
      cognitoEnv,
      5,
    );
    const socketAuthorizer = new WebSocketLambdaAuthorizer('SocketAuthorizer', socketAuthorizerFn, {
      identitySource: ['route.request.querystring.token'],
    });
    const socketIntegration = new integrations.WebSocketLambdaIntegration(
      'SocketIntegration',
      functions.socket,
    );

    this.webSocketApi = new apigwv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: 'gameplan-socket',
      description: 'Delivery only. Clients send messages over HTTP.',
      connectRouteOptions: {
        integration: socketIntegration,
        authorizer: socketAuthorizer,
      },
      disconnectRouteOptions: { integration: socketIntegration },
      defaultRouteOptions: { integration: socketIntegration },
    });

    const socketStage = new apigwv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    functions.fanout.addEnvironment('WEBSOCKET_CALLBACK_URL', socketStage.callbackUrl);
    socketStage.grantManagementApiAccess(functions.fanout);
    pushTopic.grantPublish(functions.fanout);
    queue.grantSendMessages(functions.chat);
    queue.grantSendMessages(functions.schedule);
    functions.fanout.addEventSource(
      new SqsEventSource(queue, { batchSize: 10, reportBatchItemFailures: true }),
    );

    for (const area of TABLE_AREAS) {
      props.table.grantReadWriteData(functions[area]);
    }
    // Identity confirms new Cognito signups so login works without an email-code UI in v1.
    props.userPool.grant(functions.identity, 'cognito-idp:AdminConfirmSignUp');
    props.mediaBucket.grantRead(functions.media);
    props.mediaBucket.grantPut(functions.media);

    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.apiEndpoint,
      exportName: 'GamePlanHttpApiUrl',
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: socketStage.url,
      exportName: 'GamePlanWebSocketUrl',
    });
  }
}
