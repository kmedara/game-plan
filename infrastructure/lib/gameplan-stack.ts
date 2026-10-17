/**
 * Cloud Development Kit (CDK) stacks for the GamePlan product.
 *
 * DNS, the platform (Cognito, DynamoDB, and the website buckets), and the API
 * deploy separately. The API stack reads the earlier stacks through CloudFormation
 * exports, so a later API deploy does not recreate Cognito or the hosted-zone records.
 */

import * as cdk from 'aws-cdk-lib';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { Api } from './api';
import { Auth, type AuthSocialContext } from './auth';
import { Database } from './database';
import { ZoneDns } from './dns';
import { Storage } from './storage';
import type { SiteApiProps } from './site-api';

/** Hosted zone and website hostname shared by the DNS and API stacks. */
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
  /** Certificate ARN in `us-east-1` for CloudFront. */
  public readonly siteCertificateArn: string;

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
    if (dns.siteCertificateArn === undefined) {
      throw new Error('The DNS stack requires a certificate output');
    }
    this.siteCertificateArn = dns.siteCertificateArn;

    new cdk.CfnOutput(this, 'SiteCertificateArn', { value: this.siteCertificateArn });
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
  /** Website hostname. Set with `certificateArn` after the DNS stack exists. */
  siteHostname?: string;
  /** CloudFront certificate ARN from {@link GamePlanDns}. */
  certificateArn?: string;
  /**
   * API origin for `/api/*` on the website distribution.
   *
   * Set only after the API stack has published the regional domain and secret ARN.
   */
  sharedApi?: SiteApiProps;
};

/**
 * Cognito, DynamoDB, and the website buckets. These exist before the API functions.
 */
export class GamePlanPlatform extends cdk.Stack {
  /** Cognito user pool that owns accounts. */
  public readonly userPool: cognito.UserPool;

  /** Public app client used by the Hosted UI. */
  public readonly userPoolClient: cognito.UserPoolClient;

  /** Cognito Hosted UI domain name, without a scheme. */
  public readonly hostedUiDomain: string;

  /** Product DynamoDB table. */
  public readonly table: dynamodb.Table;

  /** Private bucket for message files. */
  public readonly mediaBucket: s3.Bucket;

  /** CloudFront distribution that serves the website. */
  public readonly distribution: cloudfront.Distribution;

  /**
   * Creates auth, the table, and storage.
   *
   * @param scope - The CDK app.
   * @param id - The stack id.
   * @param props - OAuth URLs and the optional website certificate.
   */
  constructor(scope: Construct, id: string, props: GamePlanPlatformProps) {
    super(scope, id, props);

    const auth = new Auth(this, 'Auth', {
      callbackUrls: props.callbackUrls,
      logoutUrls: props.logoutUrls,
      social: props.social,
      selfSignUpEnabled: props.selfSignUpEnabled,
      signupAllowlistParameter: props.signupAllowlistParameter,
    });
    this.userPool = auth.userPool;
    this.userPoolClient = auth.userPoolClient;
    this.hostedUiDomain = auth.hostedUiDomain;

    this.table = new Database(this, 'Database').table;

    const storage = new Storage(this, 'Storage', {
      corsOrigin: props.corsOrigin,
      siteHostname: props.siteHostname,
      certificateArn: props.certificateArn,
      sharedApi: props.sharedApi,
    });
    this.mediaBucket = storage.mediaBucket;
    this.distribution = storage.distribution;
  }
}

/** Props for {@link GamePlanApi}. */
export type GamePlanApiProps = cdk.StackProps & {
  /** Browser origin allowed by Cross-Origin Resource Sharing (CORS) on the HTTP API. */
  corsOrigin: string;
  /** Absolute OAuth callback URL for the identity routes. */
  authCallbackUrl: string;
  /** User pool from {@link GamePlanPlatform}. */
  userPool: cognito.IUserPool;
  /** App client from {@link GamePlanPlatform}. */
  userPoolClient: cognito.IUserPoolClient;
  /** Hosted UI domain from {@link GamePlanPlatform}. */
  hostedUiDomain: string;
  /** DynamoDB table from {@link GamePlanPlatform}. */
  table: dynamodb.Table;
  /** Media bucket from {@link GamePlanPlatform}. */
  mediaBucket: s3.IBucket;
  /** Website distribution from {@link GamePlanPlatform}. Alias records point at it. */
  distribution: cloudfront.Distribution;
  /** Present when the DNS stack owns the hosted zone. The API stack writes the alias records. */
  dns?: DnsConfig;
  /**
   * Browser base URL for the HTTP API, such as `https://app.example.com/api`.
   *
   * Clients and the OAuth callback use the website host. CloudFront calls the
   * HTTP API execute-api domain.
   */
  browserApiBaseUrl?: string;
};

/**
 * HTTP API, WebSocket API, and the alias record for the website hostname.
 */
export class GamePlanApi extends cdk.Stack {
  /**
   * Wires the area functions to the platform resources.
   *
   * @param scope - The CDK app.
   * @param id - The stack id.
   * @param props - Platform resources and the website distribution.
   */
  constructor(scope: Construct, id: string, props: GamePlanApiProps) {
    super(scope, id, props);

    new Api(this, 'Api', {
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      hostedUiDomain: props.hostedUiDomain,
      authCallbackUrl: props.authCallbackUrl,
      table: props.table,
      mediaBucket: props.mediaBucket,
      corsOrigin: props.corsOrigin,
      protectOrigin: props.dns !== undefined,
      browserApiBaseUrl: props.browserApiBaseUrl,
    });

    if (props.dns !== undefined) {
      const dns = new ZoneDns(this, 'Dns', {
        ...props.dns,
        certificates: false,
        handlerId: 'dns-aliases',
      });
      dns.addAliases({ distribution: props.distribution });
    }
  }
}
