/**
 * HTTP API and WebSocket API wiring for every product area Lambda.
 */

import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer, WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { AREAS, type Area } from './names';
import {
  CHAT_PREFIX,
  DIRECTORY_KEY,
  HANDOFF_PREFIX,
  INVITE_PREFIX,
  REMINDERS_KEY,
  TEAM_PREFIX,
  TICKET_PREFIX,
  USER_PREFIX,
  grantPartitions,
} from './table-access';
import { areaEntry, createAreaFunctions, createFunction } from './functions';

/** Inputs the API construct needs from the auth, database, and storage constructs. */
export type ApiProps = {
  /** Cognito user pool that issues access tokens for HTTP and WebSocket clients. */
  userPool: cognito.IUserPool;
  /** App client used by the website and the Expo app. */
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
  /**
   * When set, Lambdas require the CloudFront origin header and the stack publishes
   * the execute-api hostname for the website distribution.
   */
  protectOrigin?: boolean;
  /**
   * Public base URL the browser and the Expo app use, such as `https://staging.example.com/api`.
   *
   * When set, the published API URL points here. API Gateway stays on its execute-api domain.
   */
  browserApiBaseUrl?: string;
};

/**
 * Areas whose HTTP routes stay open so register and login can run before a token exists.
 */
const PUBLIC_HTTP = new Set<Area>(['identity']);

/** HTTP areas that must see the CloudFront origin header. Socket and fan-out are not HTTP. */
const EDGE_AREAS: readonly Area[] = ['identity', 'teams', 'schedule', 'chat', 'media', 'places'];

/**
 * Access log line written for each API Gateway request.
 *
 * `path` is the request path (`/identity/profile/complete`). `routeKey` is the
 * matched template (`POST /identity/{proxy+}`). `error` is an API Gateway
 * failure; a Lambda JSON `{ error }` body is logged by the function instead.
 */
const ACCESS_LOG_FORMAT = JSON.stringify({
  requestId: '$context.requestId',
  path: '$context.path',
  routeKey: '$context.routeKey',
  status: '$context.status',
  error: '$context.error.message',
});

/**
 * Account-level role API Gateway uses to publish access logs.
 *
 * HTTP and WebSocket stages both refuse access logging until this role ARN is stored
 * in the API Gateway account settings for the region.
 *
 * @param scope - The construct that owns the role.
 * @returns The account setting that must exist before a stage enables logging.
 */
const ensureApiGatewayLoggingRole = (scope: Construct): apigateway.CfnAccount => {
  const role = new iam.Role(scope, 'ApiGatewayCloudWatchRole', {
    assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
    ],
  });
  return new apigateway.CfnAccount(scope, 'ApiGatewayAccount', {
    cloudWatchRoleArn: role.roleArn,
  });
};

/**
 * Sends stage access logs to CloudWatch.
 *
 * Staging keeps the group for one day. Other environments keep it for one month.
 * HTTP API stages cannot enable X-Ray; the Lambdas trace those requests instead.
 *
 * @param scope - The construct that owns the log group.
 * @param account - Account setting that holds the CloudWatch Logs role ARN.
 * @param stage - The HTTP or WebSocket stage.
 * @param id - The log group construct id.
 * @param logGroupName - The CloudWatch log group name.
 */
const enableAccessLogs = (
  scope: Construct,
  account: apigateway.CfnAccount,
  stage: apigwv2.IStage | undefined,
  id: string,
  logGroupName: string,
): void => {
  const cfnStage = stage?.node.defaultChild;
  if (!(cfnStage instanceof apigwv2.CfnStage)) {
    throw new Error(`${id} is missing its stage`);
  }
  const group = new logs.LogGroup(scope, id, {
    logGroupName,
    retention:
      process.env.DEPLOY_ENV === 'staging' ? logs.RetentionDays.ONE_DAY : logs.RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
  group.grantWrite(new iam.ServicePrincipal('apigateway.amazonaws.com'));
  cfnStage.accessLogSettings = {
    destinationArn: group.logGroupArn,
    format: ACCESS_LOG_FORMAT,
  };
  cfnStage.node.addDependency(account);
};

/**
 * HTTP API plus the WebSocket API. Each area is its own function.
 *
 * The gateway checks the Cognito access token on HTTP routes. WebSocket APIs have no
 * Cognito authorizer, so `$connect` burns a one-time ticket from
 * `POST /identity/socket-ticket`.
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

    const apiLoggingAccount = ensureApiGatewayLoggingRole(this);

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
          return { ...shared, ...tableEnv, ...queueEnv };
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
          return {
            ...shared,
            ...tableEnv,
            ...queueEnv,
            PUSH_TOPIC_ARN: pushTopic.topicArn,
            VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? '',
            VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? '',
            VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? 'mailto:push@gameplan.local',
          };
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
      // The website distribution connects to the execute-api hostname. An earlier
      // deploy turned it off, and removing the property does not turn it back on.
      disableExecuteApiEndpoint: false,
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
    enableAccessLogs(this, apiLoggingAccount, this.httpApi.defaultStage, 'HttpAccessLogs', '/gameplan/http-api');

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
      // `{proxy+}` requires a segment after the area, so `/teams` and `/chat` need
      // their own route. ANY also matches OPTIONS and is more specific than the
      // CORS preflight route `OPTIONS /{proxy+}`, so a preflight would hit the
      // Lambda and return 404.
      const areaMethods = [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.PUT,
        apigwv2.HttpMethod.PATCH,
        apigwv2.HttpMethod.DELETE,
      ];
      const areaRoute = {
        methods: areaMethods,
        integration,
        ...(PUBLIC_HTTP.has(area) ? {} : { authorizer: httpAuthorizer }),
      };
      this.httpApi.addRoutes({ path: `/${area}`, ...areaRoute });
      this.httpApi.addRoutes({ path: `/${area}/{proxy+}`, ...areaRoute });
    }

    const socketAuthorizerFn = createFunction(
      this,
      'socket-authorizer',
      areaEntry('socket', 'authorize.ts'),
      tableEnv,
      5,
    );
    grantPartitions(props.table, socketAuthorizerFn, { write: [TICKET_PREFIX] });
    const socketAuthorizer = new WebSocketLambdaAuthorizer('SocketAuthorizer', socketAuthorizerFn, {
      identitySource: ['route.request.querystring.ticket'],
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

    const socketAuthorizerResource = this.node.findAll().find(
      (node): node is apigwv2.CfnAuthorizer =>
        node instanceof apigwv2.CfnAuthorizer && node.node.scope?.node.id === 'SocketAuthorizer',
    );
    if (socketAuthorizerResource === undefined) {
      throw new Error('Socket authorizer resource was not created');
    }
    // WebSocket APIs reject AuthorizerResultTtlInSeconds. Omitting it means $connect
    // invokes the authorizer every time, so a cached Allow cannot replay a ticket.
    socketAuthorizerResource.addPropertyDeletionOverride('AuthorizerResultTtlInSeconds');

    const socketStage = new apigwv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });
    enableAccessLogs(this, apiLoggingAccount, socketStage, 'SocketAccessLogs', '/gameplan/websocket-api');

    functions.fanout.addEnvironment('WEBSOCKET_CALLBACK_URL', socketStage.callbackUrl);
    socketStage.grantManagementApiAccess(functions.fanout);
    pushTopic.grantPublish(functions.fanout);
    queue.grantSendMessages(functions.chat);
    queue.grantSendMessages(functions.schedule);
    queue.grantSendMessages(functions.teams);
    functions.fanout.addEventSource(
      new SqsEventSource(queue, { batchSize: 10, reportBatchItemFailures: true }),
    );

    new events.Rule(this, 'ReminderSweep', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [
        new targets.LambdaFunction(functions.schedule, {
          event: events.RuleTargetInput.fromObject({ source: 'gameplan.reminders' }),
        }),
      ],
    });

    grantPartitions(props.table, functions.identity, {
      read: [USER_PREFIX, TICKET_PREFIX, HANDOFF_PREFIX],
      write: [USER_PREFIX, TICKET_PREFIX, HANDOFF_PREFIX],
      emailIndex: true,
    });
    grantPartitions(props.table, functions.teams, {
      read: [TEAM_PREFIX, USER_PREFIX, CHAT_PREFIX, INVITE_PREFIX, DIRECTORY_KEY],
      write: [TEAM_PREFIX, USER_PREFIX, CHAT_PREFIX, INVITE_PREFIX, DIRECTORY_KEY],
      transact: true,
    });
    grantPartitions(props.table, functions.schedule, {
      read: [TEAM_PREFIX, REMINDERS_KEY],
      write: [TEAM_PREFIX, REMINDERS_KEY],
    });
    grantPartitions(props.table, functions.chat, {
      read: [CHAT_PREFIX, USER_PREFIX, TEAM_PREFIX],
      write: [CHAT_PREFIX, USER_PREFIX],
      transact: true,
      emailIndex: true,
    });
    grantPartitions(props.table, functions.media, {
      // Team metadata stores the shared logo and chat background. A teammate
      // download has to read that row; the uploader is allowed from the key
      // prefix and never reaches it.
      read: [USER_PREFIX, CHAT_PREFIX, TEAM_PREFIX],
      write: [USER_PREFIX],
    });
    grantPartitions(props.table, functions.socket, {
      read: [USER_PREFIX, TICKET_PREFIX],
      write: [USER_PREFIX, TICKET_PREFIX],
      connectionIndex: true,
    });
    grantPartitions(props.table, functions.fanout, {
      read: [CHAT_PREFIX, TEAM_PREFIX, USER_PREFIX],
    });
    // Replace an unconfirmed signup so a later register can prove the same inbox.
    // Confirmed users are not deleted. Sign-up confirmation uses the public client API.
    props.userPool.grant(
      functions.identity,
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminDeleteUser',
    );
    props.mediaBucket.grantRead(functions.media);
    props.mediaBucket.grantPut(functions.media);

    if (props.protectOrigin === true) {
      const originSecret = new secretsmanager.Secret(this, 'OriginVerifySecret', {
        description: 'Header CloudFront sends so clients cannot call API Gateway directly.',
        generateSecretString: { excludePunctuation: true, passwordLength: 32 },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      const readOriginSecret = new AwsCustomResource(this, 'ReadOriginVerifySecret', {
        onCreate: {
          service: 'SecretsManager',
          action: 'getSecretValue',
          parameters: { SecretId: originSecret.secretArn },
          physicalResourceId: PhysicalResourceId.of('GamePlanOriginVerify'),
        },
        policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [originSecret.secretArn] }),
      });
      readOriginSecret.node.addDependency(originSecret);
      const originVerify = readOriginSecret.getResponseField('SecretString');
      for (const area of EDGE_AREAS) {
        functions[area].addEnvironment('ORIGIN_VERIFY_SECRET', originVerify);
      }
      const executeApiDomain = cdk.Fn.select(
        0,
        cdk.Fn.split('/', cdk.Fn.select(1, cdk.Fn.split('://', this.httpApi.apiEndpoint))),
      );
      new cdk.CfnOutput(this, 'ApiRegionalDomain', { value: executeApiDomain });
      new cdk.CfnOutput(this, 'OriginVerifySecretArn', { value: originSecret.secretArn });
    }

    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: props.browserApiBaseUrl ?? this.httpApi.apiEndpoint,
      exportName: 'GamePlanHttpApiUrl',
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: socketStage.url,
      exportName: 'GamePlanWebSocketUrl',
    });
  }
}
