/**
 * Amazon Simple Storage Service (S3) buckets and CloudFront for media and the website.
 */

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { addSiteApiBehavior, createSiteApiEdge, type SiteApiProps } from './site-api';

/** Inputs for the storage construct. */
export type StorageProps = {
  /** Browser origin allowed to upload and download message files. */
  corsOrigin: string;
  /** Website hostname served by this distribution. */
  siteHostname?: string;
  /** CloudFront certificate ARN in `us-east-1`. Required with `siteHostname`. */
  certificateArn?: string;
  /**
   * Present after the API stack has published its regional domain and origin secret.
   * Adds `/api/*` on this distribution and stops rewriting API errors to `index.html`.
   */
  sharedApi?: SiteApiProps;
};

/**
 * Two buckets. Message files stay private and are signed later. The website is a static build
 * served by CloudFront. Dev stacks delete both buckets with the stack.
 */
export class Storage extends Construct {
  /** Private bucket for message photos and files. */
  public readonly mediaBucket: s3.Bucket;

  /** Private origin bucket for the Expo static website export. */
  public readonly siteBucket: s3.Bucket;

  /** CloudFront distribution that serves the website over HTTPS. */
  public readonly distribution: cloudfront.Distribution;

  /**
   * Creates the media bucket, site bucket, distribution, and related outputs.
   *
   * @param scope - The parent CDK construct.
   * @param id - The construct id.
   * @param props - CORS origin for the media bucket.
   */
  constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);

    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
          allowedOrigins: [props.corsOrigin],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `gameplan-site-${cdk.Stack.of(this).account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const siteApi = props.sharedApi === undefined ? undefined : createSiteApiEdge(this, props.sharedApi);

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'GamePlan website security headers',
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'GamePlan website',
      webAclId: siteApi?.webAcl.attrArn,
      domainNames: props.siteHostname === undefined ? undefined : [props.siteHostname],
      certificate:
        props.certificateArn === undefined
          ? undefined
          : acm.Certificate.fromCertificateArn(this, 'SiteCertificate', props.certificateArn),
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy,
        functionAssociations:
          siteApi === undefined
            ? undefined
            : [
                {
                  function: siteApi.spaRewrite,
                  eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                },
              ],
      },
      // Distribution-wide error pages would also rewrite API 403 and 404 responses.
      // The SPA function covers website routes once `/api/*` shares this distribution.
      errorResponses:
        siteApi === undefined
          ? [
              {
                httpStatus: 403,
                responseHttpStatus: 200,
                responsePagePath: '/index.html',
                ttl: cdk.Duration.minutes(5),
              },
              {
                httpStatus: 404,
                responseHttpStatus: 200,
                responsePagePath: '/index.html',
                ttl: cdk.Duration.minutes(5),
              },
            ]
          : undefined,
    });
    if (siteApi !== undefined && props.sharedApi !== undefined) {
      addSiteApiBehavior(this.distribution, siteApi, props.sharedApi);
    }

    const siteUrl =
      props.siteHostname === undefined
        ? `https://${this.distribution.distributionDomainName}`
        : `https://${props.siteHostname}`;

    new cdk.CfnOutput(this, 'MediaBucketName', {
      value: this.mediaBucket.bucketName,
      exportName: 'GamePlanMediaBucketName',
    });

    new cdk.CfnOutput(this, 'SiteBucketName', {
      value: this.siteBucket.bucketName,
      exportName: 'GamePlanSiteBucketName',
    });

    new cdk.CfnOutput(this, 'SiteDistributionId', {
      value: this.distribution.distributionId,
      exportName: 'GamePlanSiteDistributionId',
    });

    new cdk.CfnOutput(this, 'SiteUrl', {
      value: siteUrl,
      exportName: 'GamePlanSiteUrl',
    });

    new cdk.CfnOutput(this, 'SiteApiEnabled', {
      value: props.sharedApi === undefined ? 'false' : 'true',
    });
  }
}
