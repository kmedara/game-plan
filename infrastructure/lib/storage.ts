/**
 * Amazon Simple Storage Service (S3) buckets and CloudFront for media and the website.
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

/** Inputs for the storage construct. */
export type StorageProps = {
  /** Browser origin allowed to upload and download message files. */
  corsOrigin: string;
};

/**
 * Two buckets. Message files stay private and are signed later. The website is a static build
 * served by CloudFront. Dev stacks delete both buckets with the stack.
 */
export class Storage extends Construct {
  /** Private bucket for message photos and files. */
  public readonly mediaBucket: s3.Bucket;

  /** Private origin bucket for the Angular static build. */
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
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

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
      },
      errorResponses: [
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
      ],
    });

    const siteUrl = `https://${this.distribution.distributionDomainName}`;

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
  }
}
