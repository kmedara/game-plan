/**
 * Function URLs and WebSocket API wiring for every product area Lambda.
 */

import { createHash } from 'node:crypto';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { HTTP_AREAS, type Area, type HttpArea } from './names';
import {
  CHAT_PREFIX,
  DIRECTORY_KEY,
  FEED_PREFIX,
  FIXTURE_PREFIX,
  HANDOFF_PREFIX,
  INVITE_PREFIX,
  ORG_PREFIX,
  PAYMENT_REMINDERS_KEY,
  REMINDERS_KEY,
  STRIPE_ACCOUNT_PREFIX,
  STRIPE_CUSTOMER_PREFIX,
  TEAM_PREFIX,
  TICKET_PREFIX,
  USER_PREFIX,
  grantPartitions,
} from './table-access';
import { areaEntry, createAreaFunctions, createFunction } from './functions';
import { denyFunctionUrlExceptSourceIps } from './lambda-url-policy';
import { stripeWebhookSourceCidrs } from './stripe-webhook-ips';

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
  /** Social providers on the user pool, which identity lists for the login screen. */
  socialProviders?: readonly string[];
  /** Single-table DynamoDB resource for user, team, schedule, and chat data. */
  table: dynamodb.Table;
  /** Private bucket that stores message file bytes. */
  mediaBucket: s3.IBucket;
  /** Browser origin the functions use when they build absolute links. */
  corsOrigin: string;
  /** Parameter Store prefix that holds the deploy secrets, such as `/gameplan`. */
  ssmPrefix: string;
  /**
   * RSA public key PEM for media URLs signed for the website distribution.
   * Without it, downloads stay on presigned S3 URLs.
   */
  mediaSigningPublicKey?: string;
  /**
   * Website hostname verified in SES. The teams function emails invites from
   * `invites@` this host. Without it, the app opens the person's own mail app.
   */
  inviteEmailDomain?: string;
  /**
   * ARN of the registered toll-free number that texts invites. Without it, the
   * app opens the person's own messages app.
   */
  smsOriginationIdentity?: string;
};

/**
 * Lets a function read one Parameter Store name.
 *
 * @param fn - The function that reads the parameter.
 * @param name - The full parameter name, with its leading slash.
 */
const allowParameterRead = (fn: lambda.IFunction, name: string): void => {
  fn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        cdk.Stack.of(fn).formatArn({
          service: 'ssm',
          resource: 'parameter',
          resourceName: name.replace(/^\//u, ''),
          arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
        }),
      ],
    }),
  );
};

/**
 * Creates the CloudFront public key and key group that sign media URLs.
 *
 * The key name includes a hash of the PEM: a new key replaces the resource, and
 * CloudFront rejects two keys with one name while both exist during the swap.
 *
 * @param scope - The construct that owns the key.
 * @param publicKeyPem - RSA public key in PEM form.
 * @param siteOrigin - Website origin the signed URLs point at.
 * @returns The public key and the key group that trusts it.
 */
const createMediaSigningKey = (
  scope: Construct,
  publicKeyPem: string,
  siteOrigin: string,
): { publicKey: cloudfront.PublicKey; keyGroup: cloudfront.KeyGroup } => {
  if (!siteOrigin.startsWith('https://')) {
    throw new Error('MEDIA_SIGNING_PUBLIC_KEY requires an https website origin');
  }
  const encodedKey = `${publicKeyPem.trim()}\n`;
  const hash = createHash('sha256').update(encodedKey).digest('hex').slice(0, 12);
  const publicKey = new cloudfront.PublicKey(scope, 'MediaSigningKey', {
    publicKeyName: `gameplan-media-${hash}`,
    encodedKey,
    comment: 'Signs media URLs served by the website',
  });
  const keyGroup = new cloudfront.KeyGroup(scope, 'MediaKeyGroup', {
    keyGroupName: 'gameplan-media',
    items: [publicKey],
  });
  return { publicKey, keyGroup };
};

/**
 * Access log line written for each WebSocket API request.
 *
 * `error` is an API Gateway failure; a Lambda JSON `{ error }` body is logged
 * by the function instead.
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
 *
 * @param scope - The construct that owns the log group.
 * @param account - Account setting that holds the CloudWatch Logs role ARN.
 * @param stage - The WebSocket stage.
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
 * Area function URLs plus the WebSocket API. Each area is its own function.
 *
 * The function URLs require IAM. The site stack lets only the website
 * distribution call them, so every HTTP request passes the website firewall.
 * The functions verify the Cognito access token themselves. WebSocket APIs have
 * no Cognito authorizer, so `$connect` burns a one-time ticket from
 * `POST /identity/socket-ticket`.
 *
 * AWS WAF cannot attach to a WebSocket API, so clients connect through the
 * website distribution instead. CloudFront sends the value of
 * {@link socketOriginParameter} on each connect, and the authorizer rejects a
 * connect without it.
 */
export class Api extends Construct {
  /** Amazon API Gateway WebSocket API used for live delivery only. */
  public readonly webSocketApi: apigwv2.WebSocketApi;

  /** WebSocket stage CloudFront forwards connects to. */
  public readonly webSocketStage: apigwv2.WebSocketStage;

  /**
   * Parameter Store name of the value CloudFront adds to each socket connect.
   *
   * Set by hand to a random String. CloudFormation cannot resolve a SecureString
   * into a distribution, so it cannot be one.
   */
  public readonly socketOriginParameter: string;

  /** IAM-only function URL for each HTTP area. */
  public readonly functionUrls: Record<HttpArea, lambda.FunctionUrl>;

  /** Function behind each URL. */
  public readonly httpFunctions: Record<HttpArea, lambda.IFunction>;

  /** Public function URL that logs Content-Security-Policy reports. */
  public readonly cspReportUrl: lambda.FunctionUrl;

  /**
   * Key group the website trusts for `/uploads/*`, when media signing is configured.
   *
   * It lives here rather than in the site stack so the media function can read
   * the key id; the site stack deploys later.
   */
  public readonly mediaKeyGroup?: cloudfront.IKeyGroup;

  /**
   * Creates the function URLs, WebSocket routes, fan-out queue, and push topic.
   *
   * @param scope - The parent CDK construct.
   * @param id - The construct id.
   * @param props - Auth, table, and media inputs.
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

    const shared = { NODE_ENV: 'production', CLIENT_ORIGIN: props.corsOrigin };
    const tableEnv = { TABLE_NAME: props.table.tableName };
    const queueEnv = { FANOUT_QUEUE_URL: queue.queueUrl };
    // Without the pool and client ids, token checks fall back to the laptop HS256 secret.
    const tokenEnv = {
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
      COGNITO_REGION: cdk.Stack.of(this).region,
    };
    // Invites GamePlan emails and texts. A channel left out stays on the person's own app.
    const inviteSendEnv = {
      ...(props.inviteEmailDomain === undefined ? {} : { INVITE_EMAIL_FROM: `invites@${props.inviteEmailDomain}` }),
      ...(props.smsOriginationIdentity === undefined ? {} : { SMS_ORIGINATION_IDENTITY: props.smsOriginationIdentity }),
    };
    const oauthEnv = {
      COGNITO_HOSTED_UI_DOMAIN: props.hostedUiDomain,
      AUTH_CALLBACK_URL: props.authCallbackUrl,
      AUTH_SOCIAL_PROVIDERS: (props.socialProviders ?? []).join(','),
    };
    // Functions get parameter names only. The secret values are read at run time.
    const mapsKeyParameter = `${props.ssmPrefix}/google-maps-api-key`;
    const vapidPrivateKeyParameter = `${props.ssmPrefix}/vapid-private-key`;
    const originSecretParameter = `${props.ssmPrefix}/socket-origin-verify`;
    const stripeSecretKeyParameter = `${props.ssmPrefix}/stripe-secret-key`;
    const stripeWebhookSecretParameter = `${props.ssmPrefix}/stripe-webhook-secret`;
    const paymentsEnv = {
      STRIPE_SECRET_KEY_PARAMETER: stripeSecretKeyParameter,
      STRIPE_WEBHOOK_SECRET_PARAMETER: stripeWebhookSecretParameter,
      PLATFORM_FEE_BPS: process.env.PLATFORM_FEE_BPS ?? '200',
      PAYMENTS_RETURN_URL: `${props.corsOrigin.replace(/\/+$/u, '')}/api/payments/return`,
    };
    const stripeBillingWebhookSecretParameter = `${props.ssmPrefix}/stripe-billing-webhook-secret`;
    const billingEnv = {
      STRIPE_SECRET_KEY_PARAMETER: stripeSecretKeyParameter,
      STRIPE_BILLING_WEBHOOK_SECRET_PARAMETER: stripeBillingWebhookSecretParameter,
      BILLING_RETURN_URL: `${props.corsOrigin.replace(/\/+$/u, '')}/api/billing/return`,
    };
    this.socketOriginParameter = originSecretParameter;
    const mediaSigningKeyParameter = `${props.ssmPrefix}/media-signing-private-key`;
    const mediaSigning = props.mediaSigningPublicKey === undefined
      ? undefined
      : createMediaSigningKey(this, props.mediaSigningPublicKey, props.corsOrigin);
    this.mediaKeyGroup = mediaSigning?.keyGroup;
    const mediaCdnEnv: Record<string, string> = mediaSigning === undefined
      ? {}
      : {
          MEDIA_CDN_ORIGIN: props.corsOrigin,
          MEDIA_SIGNING_KEY_ID: mediaSigning.publicKey.publicKeyId,
          MEDIA_SIGNING_PRIVATE_KEY_PARAMETER: mediaSigningKeyParameter,
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
          return {
            ...shared,
            ...tableEnv,
            ...tokenEnv,
            ...oauthEnv,
            // Account deletion removes the profile photo.
            MEDIA_BUCKET: props.mediaBucket.bucketName,
          };
        case 'teams':
          return { ...shared, ...tableEnv, ...tokenEnv, ...queueEnv, ...inviteSendEnv };
        case 'socket':
          return { ...shared, ...tableEnv };
        case 'schedule':
        case 'chat':
          return { ...shared, ...tableEnv, ...tokenEnv, ...queueEnv };
        case 'media':
          return {
            ...shared,
            ...tableEnv,
            ...tokenEnv,
            MEDIA_BUCKET: props.mediaBucket.bucketName,
            ...mediaCdnEnv,
          };
        case 'places':
          return {
            ...shared,
            ...tokenEnv,
            GOOGLE_MAPS_API_KEY_PARAMETER: mapsKeyParameter,
          };
        case 'payments':
          return { ...shared, ...tableEnv, ...tokenEnv, ...queueEnv, ...paymentsEnv };
        case 'billing':
          return { ...shared, ...tableEnv, ...tokenEnv, ...billingEnv };
        case 'orgs':
          // The Stripe key keeps the extra-team quantity in step as teams join and leave.
          return { ...shared, ...tableEnv, ...tokenEnv, ...queueEnv, STRIPE_SECRET_KEY_PARAMETER: stripeSecretKeyParameter };
        case 'fanout':
          return {
            ...shared,
            ...tableEnv,
            ...queueEnv,
            VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? '',
            VAPID_PRIVATE_KEY_PARAMETER: vapidPrivateKeyParameter,
            VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? 'mailto:push@gameplan.local',
          };
        default: {
          const exhaustive: never = area;
          return exhaustive;
        }
      }
    };

    const functions = createAreaFunctions(this, environmentFor);
    allowParameterRead(functions.places, mapsKeyParameter);
    allowParameterRead(functions.fanout, vapidPrivateKeyParameter);
    if (mediaSigning !== undefined) allowParameterRead(functions.media, mediaSigningKeyParameter);
    allowParameterRead(functions.payments, stripeSecretKeyParameter);
    allowParameterRead(functions.payments, stripeWebhookSecretParameter);

    // Stripe cannot sign for CloudFront's origin access control, so the webhook
    // gets its own function with a public URL. Non-Stripe source IPs are denied
    // at the URL; the handler still verifies the Stripe signature on the body.
    const paymentsWebhookFn = createFunction(
      this,
      'payments-webhook',
      areaEntry('payments', 'webhook-handler.ts'),
      { ...shared, ...tableEnv, ...queueEnv, ...paymentsEnv },
    );
    allowParameterRead(paymentsWebhookFn, stripeSecretKeyParameter);
    allowParameterRead(paymentsWebhookFn, stripeWebhookSecretParameter);
    const paymentsWebhookUrl = paymentsWebhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    denyFunctionUrlExceptSourceIps(this, 'PaymentsWebhookIpDeny', paymentsWebhookFn, stripeWebhookSourceCidrs());

    // Same reason as the payments webhook: Stripe cannot sign for origin access control.
    allowParameterRead(functions.billing, stripeSecretKeyParameter);
    allowParameterRead(functions.orgs, stripeSecretKeyParameter);
    const billingWebhookFn = createFunction(
      this,
      'billing-webhook',
      areaEntry('billing', 'webhook-handler.ts'),
      { ...shared, ...tableEnv, ...billingEnv },
    );
    allowParameterRead(billingWebhookFn, stripeSecretKeyParameter);
    allowParameterRead(billingWebhookFn, stripeBillingWebhookSecretParameter);
    const billingWebhookUrl = billingWebhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    denyFunctionUrlExceptSourceIps(this, 'BillingWebhookIpDeny', billingWebhookFn, stripeWebhookSourceCidrs());

    // Browsers send policy reports without the body hash origin access control
    // needs, so the reporter is public too. It only writes log lines.
    const cspReportFn = createFunction(this, 'csp-report', areaEntry('identity', 'csp-report.ts'), {}, 5);
    this.cspReportUrl = cspReportFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    const functionUrls = {} as Record<HttpArea, lambda.FunctionUrl>;
    const httpFunctions = {} as Record<HttpArea, lambda.IFunction>;
    for (const area of HTTP_AREAS) {
      functionUrls[area] = functions[area].addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.AWS_IAM,
      });
      httpFunctions[area] = functions[area];
    }
    this.functionUrls = functionUrls;
    this.httpFunctions = httpFunctions;

    const socketAuthorizerFn = createFunction(
      this,
      'socket-authorizer',
      areaEntry('socket', 'authorize.ts'),
      {
        ...tableEnv,
        NODE_ENV: 'production',
        ORIGIN_VERIFY_SECRET_PARAMETER: originSecretParameter,
      },
      5,
    );
    grantPartitions(props.table, socketAuthorizerFn, { write: [TICKET_PREFIX] });
    allowParameterRead(socketAuthorizerFn, originSecretParameter);
    // A connect missing either identity source gets 401 without invoking the function.
    const socketAuthorizer = new WebSocketLambdaAuthorizer('SocketAuthorizer', socketAuthorizerFn, {
      identitySource: ['route.request.querystring.ticket', 'route.request.header.X-Origin-Verify'],
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
    this.webSocketStage = socketStage;
    enableAccessLogs(this, apiLoggingAccount, socketStage, 'SocketAccessLogs', '/gameplan/websocket-api');

    functions.fanout.addEnvironment('WEBSOCKET_CALLBACK_URL', socketStage.callbackUrl);
    socketStage.grantManagementApiAccess(functions.fanout);
    queue.grantSendMessages(functions.chat);
    queue.grantSendMessages(functions.schedule);
    queue.grantSendMessages(functions.teams);
    queue.grantSendMessages(functions.fanout);
    queue.grantSendMessages(functions.payments);
    queue.grantSendMessages(functions.orgs);
    queue.grantSendMessages(paymentsWebhookFn);
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

    new events.Rule(this, 'PaymentReminderSweep', {
      schedule: events.Schedule.cron({ minute: '0', hour: '15' }),
      targets: [
        new targets.LambdaFunction(functions.payments, {
          event: events.RuleTargetInput.fromObject({ source: 'gameplan.payment-reminders' }),
        }),
      ],
    });

    grantPartitions(props.table, functions.identity, {
      // Account deletion reads the teams, chats, and organizations a person is in,
      // rewrites private chat names, and removes their rows from those partitions.
      // A team left with nobody on it is deleted too: its invite codes, directory
      // entry, Stripe lookups, and shared games, where the other club's game is
      // rewritten (TEAM# write) to drop the link.
      read: [USER_PREFIX, TICKET_PREFIX, HANDOFF_PREFIX, TEAM_PREFIX, CHAT_PREFIX, ORG_PREFIX, FIXTURE_PREFIX],
      write: [USER_PREFIX, TICKET_PREFIX, HANDOFF_PREFIX, CHAT_PREFIX, TEAM_PREFIX],
      remove: [
        ORG_PREFIX,
        FEED_PREFIX,
        FIXTURE_PREFIX,
        INVITE_PREFIX,
        DIRECTORY_KEY,
        STRIPE_ACCOUNT_PREFIX,
        STRIPE_CUSTOMER_PREFIX,
      ],
      emailIndex: true,
    });
    grantPartitions(props.table, functions.teams, {
      // ORG# lets the membership guard recognize organization admins, here and below.
      read: [TEAM_PREFIX, USER_PREFIX, CHAT_PREFIX, INVITE_PREFIX, DIRECTORY_KEY, ORG_PREFIX],
      write: [TEAM_PREFIX, USER_PREFIX, CHAT_PREFIX, INVITE_PREFIX, DIRECTORY_KEY],
      transact: true,
    });
    grantPartitions(props.table, functions.schedule, {
      // Carpool claims write the driver-and-riders chat under CHAT# and USER#.
      // FEED# maps a calendar feed token to its owner. FIXTURE# holds games shared between clubs.
      read: [TEAM_PREFIX, REMINDERS_KEY, CHAT_PREFIX, USER_PREFIX, FEED_PREFIX, ORG_PREFIX, FIXTURE_PREFIX],
      write: [TEAM_PREFIX, REMINDERS_KEY, CHAT_PREFIX, USER_PREFIX, FEED_PREFIX, FIXTURE_PREFIX],
    });
    grantPartitions(props.table, functions.chat, {
      read: [CHAT_PREFIX, USER_PREFIX, TEAM_PREFIX, ORG_PREFIX],
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
    grantPartitions(props.table, functions.payments, {
      // Dues live on TEAM#, pointers and profiles on USER#.
      read: [TEAM_PREFIX, USER_PREFIX, STRIPE_ACCOUNT_PREFIX, PAYMENT_REMINDERS_KEY, ORG_PREFIX],
      write: [TEAM_PREFIX, USER_PREFIX, STRIPE_ACCOUNT_PREFIX, PAYMENT_REMINDERS_KEY],
      transact: true,
    });
    grantPartitions(props.table, paymentsWebhookFn, {
      read: [TEAM_PREFIX, USER_PREFIX, STRIPE_ACCOUNT_PREFIX],
      write: [TEAM_PREFIX, STRIPE_ACCOUNT_PREFIX],
      transact: true,
    });
    grantPartitions(props.table, functions.billing, {
      // Plan and billing rows on TEAM# and ORG#, the reverse customer lookup.
      read: [TEAM_PREFIX, STRIPE_CUSTOMER_PREFIX, ORG_PREFIX],
      write: [TEAM_PREFIX, STRIPE_CUSTOMER_PREFIX, ORG_PREFIX],
      transact: true,
    });
    grantPartitions(props.table, billingWebhookFn, {
      read: [TEAM_PREFIX, STRIPE_CUSTOMER_PREFIX, ORG_PREFIX],
      write: [TEAM_PREFIX, STRIPE_CUSTOMER_PREFIX, ORG_PREFIX],
      transact: true,
    });
    grantPartitions(props.table, functions.orgs, {
      // Announcements write messages under CHAT#; joining writes the team's ORG and PLAN rows.
      read: [ORG_PREFIX, TEAM_PREFIX, USER_PREFIX, CHAT_PREFIX],
      write: [ORG_PREFIX, TEAM_PREFIX, USER_PREFIX, CHAT_PREFIX],
      transact: true,
      emailIndex: true,
    });
    grantPartitions(props.table, functions.fanout, {
      read: [CHAT_PREFIX, TEAM_PREFIX, USER_PREFIX],
      // A gone socket is deleted. LeadingKeys cannot limit DeleteItem to CONN#.
      remove: [USER_PREFIX],
    });
    // Replace an unconfirmed signup so a later register can prove the same inbox,
    // and delete an account its owner asked to delete. `ListUsers` finds a
    // social account's username from its sub. Sign-up confirmation uses the public client API.
    props.userPool.grant(
      functions.identity,
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:ListUsers',
    );
    props.mediaBucket.grantDelete(functions.identity, 'uploads/*');
    props.mediaBucket.grantRead(functions.media);
    props.mediaBucket.grantPut(functions.media);

    // Teams sends invites only from the verified website host and the one registered number.
    const stack = cdk.Stack.of(this);
    if (props.inviteEmailDomain !== undefined) {
      functions.teams.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['ses:SendEmail'],
          resources: [`arn:${stack.partition}:ses:${stack.region}:${stack.account}:identity/${props.inviteEmailDomain}`],
        }),
      );
    }
    if (props.smsOriginationIdentity !== undefined) {
      functions.teams.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['sms-voice:SendTextMessage'],
          resources: [
            props.smsOriginationIdentity,
            // A number checks its opt-out list on every send.
            `arn:${stack.partition}:sms-voice:${stack.region}:${stack.account}:opt-out-list/*`,
          ],
        }),
      );
    }

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: socketStage.url,
      exportName: 'GamePlanWebSocketUrl',
    });

    // Terraform reads these two by name (stripe.tf), so keep their IDs free of
    // the construct path prefix and hash CDK would otherwise add.
    new cdk.CfnOutput(this, 'PaymentsWebhookUrl', {
      value: `${paymentsWebhookUrl.url}payments/webhook`,
      description: 'Register as a Stripe Connect webhook endpoint (events on connected accounts).',
    }).overrideLogicalId('PaymentsWebhookUrl');

    new cdk.CfnOutput(this, 'BillingWebhookUrl', {
      value: `${billingWebhookUrl.url}billing/webhook`,
      description: 'Register as a Stripe webhook endpoint on the platform account (subscriptions).',
    }).overrideLogicalId('BillingWebhookUrl');
  }
}
