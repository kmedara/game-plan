/**
 * Static website bucket and the CloudFront distribution that also serves `/api`.
 */

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { SITE_API_PREFIX } from './deploy-config';
import { addSiteApiBehaviors, createSiteApiEdge, type SiteApiProps } from './site-api';

/** Inputs for the website construct. */
export type WebsiteProps = SiteApiProps & {
  /** Website hostname served by this distribution. */
  siteHostname?: string;
  /** CloudFront certificate ARN in `us-east-1`. Required with `siteHostname`. */
  certificateArn?: string;
};

/**
 * The website is a static build served by CloudFront. The same distribution
 * forwards `/api/<area>` to the area function URLs. Dev stacks delete the bucket
 * with the stack.
 */
export class Website extends Construct {
  /** Private origin bucket for the Expo static website export. */
  public readonly siteBucket: s3.Bucket;

  /** CloudFront distribution that serves the website and `/api` over HTTPS. */
  public readonly distribution: cloudfront.Distribution;

  /** Public website URL. */
  public readonly siteUrl: string;

  /**
   * Creates the site bucket, the distribution, and the `/api` edge pieces.
   *
   * @param scope - The parent CDK construct.
   * @param id - The construct id.
   * @param props - Hostname, certificate, and area function URLs.
   */
  constructor(scope: Construct, id: string, props: WebsiteProps) {
    super(scope, id);

    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      // `gameplan-site-<account>` belonged to the platform stack. S3 can hold a
      // deleted name for a while, so the site stack uses a new one.
      bucketName: `gameplan-web-${cdk.Stack.of(this).account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const edge = createSiteApiEdge(this);

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

    // No distribution-wide error pages: they would also rewrite API 403 and 404
    // responses. The SPA function sends website routes to `index.html` instead.
    this.distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'GamePlan website',
      webAclId: edge.webAcl.attrArn,
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
        functionAssociations: [
          {
            function: edge.spaRewrite,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
    });
    addSiteApiBehaviors(this.distribution, edge, props);

    this.siteUrl =
      props.siteHostname === undefined
        ? `https://${this.distribution.distributionDomainName}`
        : `https://${props.siteHostname}`;

    new cdk.CfnOutput(this, 'SiteBucketName', { value: this.siteBucket.bucketName });
    new cdk.CfnOutput(this, 'SiteDistributionId', { value: this.distribution.distributionId });
    new cdk.CfnOutput(this, 'SiteUrl', { value: this.siteUrl });
    new cdk.CfnOutput(this, 'HttpApiUrl', { value: `${this.siteUrl}${SITE_API_PREFIX}` });
  }
}
