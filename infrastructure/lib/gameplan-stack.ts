/**
 * Cloud Development Kit (CDK) stacks for the GamePlan product.
 *
 * DNS, the platform (Cognito, DynamoDB, and the media bucket), the API, and the
 * site deploy separately, in that order. Each stack reads the earlier ones through
 * CloudFormation exports, so a later deploy does not recreate Cognito or the table.
 */

import { createHash } from 'node:crypto';
import * as cdk from 'aws-cdk-lib';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import type { Construct } from 'constructs';
import { Api } from './api';
import { Auth, type AuthProps, type AuthSocialContext, type SocialProvider } from './auth';
import { Database } from './database';
import type { MailRecord } from './deploy-config';
import { ZoneDns } from './dns';
import type { HttpArea } from './names';
import type { SiteApiProps, SiteSocketProps } from './site-api';
import { Storage } from './storage';
import { Website } from './website';

/** Hosted zone and website hostname shared by the DNS and site stacks. */
export type DnsConfig = {
  hostedZoneId: string;
  roleArn?: string;
  siteHostname: string;
};

/** Props for {@link GamePlanDns}. */
export type GamePlanDnsProps = cdk.StackProps & DnsConfig;

/**
 * Certificate validation records for the website.
 */
export class GamePlanDns extends cdk.Stack {
  /** Certificate ARN the existing cross-stack export must keep returning. */
  public readonly siteCertificateArn: string;

  /** Certificate ARN for the current website hostname. */
  public readonly currentCertificateArn: string;

  /**
   * Requests the website certificate and writes the validation records.
   *
   * @param scope - The CDK app.
   * @param id - The stack id.
   * @param props - Hosted zone, role, and website hostname.
   */
  constructor(scope: Construct, id: string, props: GamePlanDnsProps) {
    super(scope, id, props);
    const dns = new ZoneDns(this, 'Dns', { ...props, handlerId: 'dns-certificates' });
    if (dns.siteCertificateArn === undefined || dns.currentCertificateArn === undefined) {
      throw new Error('The DNS stack requires a certificate output');
    }
    this.siteCertificateArn = dns.siteCertificateArn;
    this.currentCertificateArn = dns.currentCertificateArn;

    new cdk.CfnOutput(this, 'SiteCertificateArn', { value: this.currentCertificateArn });
  }
}

/** Props for {@link GamePlanPlatform}. */
export type GamePlanPlatformProps = cdk.StackProps & {
  /** Browser origin allowed by the media bucket. */
  corsOrigin: string;
  /** Cognito OAuth callback URLs. */
  callbackUrls: string[];
  /** Cognito OAuth logout URLs. */
  logoutUrls: string[];
  /** Optional Google / Apple / Facebook Hosted UI credentials. */
  social?: AuthSocialContext;
  /** When false, the user pool rejects public sign-up. */
  selfSignUpEnabled?: boolean;
  /** Parameter Store name of the staging sign-up allowlist. */
  signupAllowlistParameter?: string;
  /** Lets the website distribution read uploads, for signed media URLs. */
  mediaCdn?: boolean;
  /** SES-verified domain Cognito sends account email from. See {@link AuthProps.sesEmailDomain}. */
  sesEmailDomain?: string;
};

/**
 * Cognito, DynamoDB, the media bucket, and the Terraform state bucket. These
 * exist before the API functions.
 */
export class GamePlanPlatform extends cdk.Stack {
  /** Cognito user pool that owns accounts. */
  public readonly userPool: cognito.UserPool;

  /** Public app client used by the Hosted UI. */
  public readonly userPoolClient: cognito.UserPoolClient;

  /** Cognito Hosted UI domain name, without a scheme. */
  public readonly hostedUiDomain: string;

  /** Social providers configured on the user pool. */
  public readonly socialProviders: readonly SocialProvider[];

  /** Product DynamoDB table. */
  public readonly table: dynamodb.Table;

  /** Private bucket for message files. */
  public readonly mediaBucket: s3.Bucket;

  /**
   * Creates auth, the table, and the media bucket.
   *
   * @param scope - The CDK app.
   * @param id - The stack id.
   * @param props - OAuth URLs and the media CORS origin.
   */
  constructor(scope: Construct, id: string, props: GamePlanPlatformProps) {
    super(scope, id, props);

    const auth = new Auth(this, 'Auth', {
      callbackUrls: props.callbackUrls,
      logoutUrls: props.logoutUrls,
      social: props.social,
      selfSignUpEnabled: props.selfSignUpEnabled,
      signupAllowlistParameter: props.signupAllowlistParameter,
      sesEmailDomain: props.sesEmailDomain,
    });
    this.userPool = auth.userPool;
    this.userPoolClient = auth.userPoolClient;
    this.hostedUiDomain = auth.hostedUiDomain;
    this.socialProviders = auth.socialProviders;

    this.table = new Database(this, 'Database').table;

    this.mediaBucket = new Storage(this, 'Storage', {
      corsOrigin: props.corsOrigin,
      cdnReads: props.mediaCdn,
    }).mediaBucket;

    // State for `infrastructure/terraform` (Stripe and Expo). It holds the webhook
    // signing secrets, and losing it would orphan the Stripe endpoints and prices,
    // so it is versioned and retained.
    const terraformState = new s3.Bucket(this, 'TerraformStateBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: cdk.Duration.days(90) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new cdk.CfnOutput(this, 'TerraformStateBucketName', { value: terraformState.bucketName });
  }
}

/** Props for {@link GamePlanApi}. */
export type GamePlanApiProps = cdk.StackProps & {
  /** Browser origin the area functions use when they build absolute links. */
  corsOrigin: string;
  /** Absolute OAuth callback URL for the identity routes. */
  authCallbackUrl: string;
  /** User pool from {@link GamePlanPlatform}. */
  userPool: cognito.IUserPool;
  /** App client from {@link GamePlanPlatform}. */
  userPoolClient: cognito.IUserPoolClient;
  /** Hosted UI domain from {@link GamePlanPlatform}. */
  hostedUiDomain: string;
  /** Social providers from {@link GamePlanPlatform}, which the login screen offers. */
  socialProviders?: readonly SocialProvider[];
  /** DynamoDB table from {@link GamePlanPlatform}. */
  table: dynamodb.Table;
  /** Media bucket from {@link GamePlanPlatform}. */
  mediaBucket: s3.IBucket;
  /** Parameter Store prefix the functions read their secrets from, such as `/gameplan`. */
  ssmPrefix: string;
  /** RSA public key PEM for signed media URLs on the website. Needs `mediaCdn` on the platform. */
  mediaSigningPublicKey?: string;
  /** Website hostname SES sends invites from. The site stack verifies it. */
  inviteEmailDomain?: string;
  /** ARN of the registered phone number that texts invites. */
  smsOriginationIdentity?: string;
};

/**
 * Area function URLs and the WebSocket API.
 */
export class GamePlanApi extends cdk.Stack {
  /** Function URL for each HTTP area. The site stack forwards `/api` here. */
  public readonly functionUrls: Record<HttpArea, lambda.FunctionUrl>;

  /** Function behind each URL. */
  public readonly httpFunctions: Record<HttpArea, lambda.IFunction>;

  /** Public function URL the site stack forwards `/api/csp-report` to. */
  public readonly cspReportUrl: lambda.FunctionUrl;

  /** WebSocket API the site stack forwards `/api/socket` to. */
  public readonly socket: SiteSocketProps;

  /** Key group the site trusts for signed media URLs, when configured. */
  public readonly mediaKeyGroup?: cloudfront.IKeyGroup;

  /**
   * Wires the area functions to the platform resources.
   *
   * @param scope - The CDK app.
   * @param id - The stack id.
   * @param props - Platform resources.
   */
  constructor(scope: Construct, id: string, props: GamePlanApiProps) {
    super(scope, id, props);

    const api = new Api(this, 'Api', {
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      hostedUiDomain: props.hostedUiDomain,
      socialProviders: props.socialProviders,
      authCallbackUrl: props.authCallbackUrl,
      table: props.table,
      mediaBucket: props.mediaBucket,
      corsOrigin: props.corsOrigin,
      ssmPrefix: props.ssmPrefix,
      mediaSigningPublicKey: props.mediaSigningPublicKey,
      inviteEmailDomain: props.inviteEmailDomain,
      smsOriginationIdentity: props.smsOriginationIdentity,
    });
    this.mediaKeyGroup = api.mediaKeyGroup;
    this.functionUrls = api.functionUrls;
    this.httpFunctions = api.httpFunctions;
    this.cspReportUrl = api.cspReportUrl;
    this.socket = {
      webSocketApi: api.webSocketApi,
      stageName: api.webSocketStage.stageName,
      originSecretParameter: api.socketOriginParameter,
    };
  }
}

/** Props for {@link GamePlanSite}. */
export type GamePlanSiteProps = cdk.StackProps &
  SiteApiProps & {
    /** Website hostname. Set with `certificateArn` when the DNS stack exists. */
    siteHostname?: string;
    /** CloudFront certificate ARN from {@link GamePlanDns}. */
    certificateArn?: string;
    /** Present when the DNS stack owns the hosted zone. This stack writes the alias records. */
    dns?: DnsConfig;
    /** Media bucket from {@link GamePlanPlatform}, allowed by the website CSP. */
    mediaBucket: s3.IBucket;
    /** Key group from {@link GamePlanApi}. Serves cached uploads at `/uploads/*` when set. */
    mediaKeyGroup?: cloudfront.IKeyGroup;
    /**
     * Domain SES sends the app's email from (`mailDomainFor`). Defaults to the
     * website hostname. Needs `dns`, which writes its DKIM records.
     */
    emailDomain?: string;
    /** The mail provider's records for the bare domain (`mailRecordsFor`). Production only. */
    mailRecords?: readonly MailRecord[];
    /**
     * Addresses SES may deliver to while the account is in the SES sandbox:
     * the staging sign-up allowlist. SES emails each one a verification link.
     */
    sesTestRecipients?: readonly string[];
  };

/**
 * Website bucket, the distribution that also serves `/api`, its firewall, and
 * the alias record. Deploys after {@link GamePlanApi} so the distribution can
 * reference the area function URLs directly.
 */
export class GamePlanSite extends cdk.Stack {
  /** CloudFront distribution that serves the website and `/api`. */
  public readonly distribution: cloudfront.Distribution;

  /**
   * Creates the website and points the hostname at it.
   *
   * @param scope - The CDK app.
   * @param id - The stack id.
   * @param props - Hostname, certificate, DNS, and the area function URLs.
   */
  constructor(scope: Construct, id: string, props: GamePlanSiteProps) {
    super(scope, id, props);

    this.distribution = new Website(this, 'Website', {
      siteHostname: props.siteHostname,
      certificateArn: props.certificateArn,
      functionUrls: props.functionUrls,
      functions: props.functions,
      cspReportUrl: props.cspReportUrl,
      socket: props.socket,
      mediaBucket: props.mediaBucket,
      mediaKeyGroup: props.mediaKeyGroup,
    }).distribution;

    if (props.dns !== undefined) {
      const dns = new ZoneDns(this, 'Dns', {
        ...props.dns,
        certificates: false,
        handlerId: 'dns-aliases',
      });
      dns.addAliases({ distribution: this.distribution });

      // Lets SES send the app's email (invites, and Cognito's account email when
      // it is switched to SES) from the mail domain. The DKIM records sign the
      // mail for that domain, so it passes DMARC without a custom MAIL FROM.
      const inviteEmail = new ses.EmailIdentity(this, 'InviteEmailIdentity', {
        identity: ses.Identity.domain(props.emailDomain ?? props.dns.siteHostname),
      });
      dns.addCnames('InviteEmailDkim', inviteEmail.dkimRecords);
      dns.addRecords('MailProviderRecords', props.mailRecords ?? []);
    }

    // In the SES sandbox, mail only reaches verified addresses. Verifying the
    // people allowed to sign up lets them receive invites on staging. The id is
    // a hash so an address does not appear in construct paths.
    for (const address of props.sesTestRecipients ?? []) {
      const id = createHash('sha256').update(address).digest('hex').slice(0, 12);
      new ses.EmailIdentity(this, `SesTestRecipient${id}`, { identity: ses.Identity.email(address) });
    }
  }
}
