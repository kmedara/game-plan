/**
 * Static website bucket and the CloudFront distribution that also serves `/api`
 * and, with a signing key, cached uploads.
 */

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { SITE_API_PREFIX } from './deploy-config';
import { MEDIA_CDN_KEY_PREFIX } from './names';
import {
  addSiteApiBehaviors,
  createSiteApiEdge,
  SITE_CSP_REPORT_PATH,
  SITE_SOCKET_PATH,
  type SiteApiProps,
} from './site-api';

/** Inputs for the website construct. */
export type WebsiteProps = SiteApiProps & {
  /** Website hostname served by this distribution. */
  siteHostname?: string;
  /** CloudFront certificate ARN in `us-east-1`. Required with `siteHostname`. */
  certificateArn?: string;
  /** Media bucket the browser uploads to, and loads from when there is no signing key. */
  mediaBucket: s3.IBucket;
  /** Key group that signs `/uploads/*` URLs. Adds the cached media behavior when set. */
  mediaKeyGroup?: cloudfront.IKeyGroup;
};

/**
 * Serves uploads from the website host behind signed URLs.
 *
 * Object keys are random and never rewritten, so the edge keeps them for a long
 * time. The cache key leaves out the signature query string, so every signed URL
 * for one object shares an edge copy.
 *
 * Uploads come from users with any content type, and this host also runs the
 * app, so each response is sandboxed: an uploaded HTML or SVG file opened
 * directly cannot run script against the site.
 *
 * @param website - The website construct.
 * @param distribution - The website distribution.
 * @param mediaBucket - The media bucket from the platform stack.
 * @param keyGroup - Key group the media function signs with.
 */
const addMediaBehavior = (
  website: Construct,
  distribution: cloudfront.Distribution,
  mediaBucket: s3.IBucket,
  keyGroup: cloudfront.IKeyGroup,
): void => {
  // The platform stack owns the bucket policy grant. Passing the owned bucket
  // would make CDK add the grant there, naming this distribution, which is a stack cycle.
  const bucket = s3.Bucket.fromBucketName(website, 'MediaOriginBucket', mediaBucket.bucketName);
  cdk.Annotations.of(website).acknowledgeWarning(
    '@aws-cdk/aws-cloudfront-origins:updateImportedBucketPolicyOac',
    'The platform stack grants CloudFront read access to uploads.',
  );
  const cachePolicy = new cloudfront.CachePolicy(website, 'MediaCache', {
    comment: 'GamePlan uploads: immutable keys, signature left out of the cache key',
    minTtl: cdk.Duration.days(1),
    defaultTtl: cdk.Duration.days(30),
    maxTtl: cdk.Duration.days(365),
    queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
    headerBehavior: cloudfront.CacheHeaderBehavior.none(),
    cookieBehavior: cloudfront.CacheCookieBehavior.none(),
  });
  const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(website, 'MediaHeaders', {
    comment: 'GamePlan uploads: sandboxed, cached by the viewer for one signing window',
    securityHeadersBehavior: {
      contentSecurityPolicy: { contentSecurityPolicy: "default-src 'none'; sandbox", override: true },
      contentTypeOptions: { override: true },
      strictTransportSecurity: {
        accessControlMaxAge: cdk.Duration.days(365),
        includeSubdomains: true,
        preload: true,
        override: true,
      },
      referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
    },
    customHeadersBehavior: {
      customHeaders: [{ header: 'Cache-Control', value: 'private, max-age=7200, immutable', override: true }],
    },
  });
  distribution.addBehavior(
    `/${MEDIA_CDN_KEY_PREFIX}/*`,
    origins.S3BucketOrigin.withOriginAccessControl(bucket, {
      originAccessLevels: [cloudfront.AccessLevel.READ],
    }),
    {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy,
      responseHeadersPolicy,
      trustedKeyGroups: [keyGroup],
    },
  );
};

/** Hosts the Maps JavaScript API loads scripts, tiles, and fonts from. */
const GOOGLE_MAPS = {
  script: ['https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.ggpht.com', 'https://*.googleusercontent.com'],
  img: ['https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.googleusercontent.com'],
  connect: ['https://*.googleapis.com', 'https://*.google.com', 'https://*.gstatic.com'],
  frame: ['https://*.google.com'],
  font: ['https://fonts.gstatic.com'],
  style: ['https://fonts.googleapis.com'],
};

/** Reporting API endpoint name the policies send violations to. */
const CSP_REPORT_GROUP = 'csp';

/**
 * Directives that send violations to {@link SITE_CSP_REPORT_PATH}.
 *
 * Chromium uses `report-to` and ignores `report-uri` when both are present.
 * Firefox and Safari only read `report-uri`.
 */
const REPORTING = [`report-uri ${SITE_CSP_REPORT_PATH}`, `report-to ${CSP_REPORT_GROUP}`];

/**
 * Report-only policy for Trusted Types.
 *
 * With Trusted Types enforced, assigning a plain string to a script sink such
 * as `innerHTML`, `eval`, or `script.src` throws, so injected markup cannot run.
 * The Metro bundle and the Maps loader set `script.src` themselves, so this
 * only reports until the logs show which sinks the app uses. To enforce it,
 * add `require-trusted-types-for 'script'` to {@link contentSecurityPolicy},
 * with a `trusted-types` allow-list for any policies those scripts create.
 */
const TRUSTED_TYPES_REPORT_ONLY = ["require-trusted-types-for 'script'", ...REPORTING].join('; ');

/**
 * Builds the website Content-Security-Policy.
 *
 * Styles allow `'unsafe-inline'` because react-native-web writes style tags at
 * run time and the Expo export inlines its reset. Scripts stay limited to this
 * origin and Google Maps. `'self'` also covers the same-origin `wss:` socket;
 * the explicit `wss:` source is for browsers that predate that rule.
 *
 * @param mediaOrigins - Presigned media bucket origins.
 * @param socketOrigin - `wss://` origin of the website host, when it is known.
 * @returns The policy string.
 */
const contentSecurityPolicy = (mediaOrigins: readonly string[], socketOrigin?: string): string =>
  [
    "default-src 'self'",
    `script-src 'self' blob: ${GOOGLE_MAPS.script.join(' ')}`,
    `style-src 'self' 'unsafe-inline' ${GOOGLE_MAPS.style.join(' ')}`,
    `img-src 'self' data: blob: ${[...mediaOrigins, ...GOOGLE_MAPS.img].join(' ')}`,
    `font-src 'self' data: ${GOOGLE_MAPS.font.join(' ')}`,
    `connect-src 'self' ${[...(socketOrigin === undefined ? [] : [socketOrigin]), ...mediaOrigins, ...GOOGLE_MAPS.connect, 'data:', 'blob:'].join(' ')}`,
    `frame-src ${GOOGLE_MAPS.frame.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...REPORTING,
  ].join('; ');

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

    const edge = createSiteApiEdge(this, props.socket.stageName);

    const region = cdk.Stack.of(this).region;
    const bucketName = props.mediaBucket.bucketName;
    // The SDK signs regional virtual-hosted URLs; the global form covers older clients.
    const mediaOrigins = [`https://${bucketName}.s3.${region}.amazonaws.com`, `https://${bucketName}.s3.amazonaws.com`];

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'GamePlan website security headers',
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: contentSecurityPolicy(
            mediaOrigins,
            props.siteHostname === undefined ? undefined : `wss://${props.siteHostname}`,
          ),
          override: true,
        },
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
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Reporting-Endpoints', value: `${CSP_REPORT_GROUP}="${SITE_CSP_REPORT_PATH}"`, override: true },
          { header: 'Content-Security-Policy-Report-Only', value: TRUSTED_TYPES_REPORT_ONLY, override: true },
        ],
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
    if (props.mediaKeyGroup !== undefined) {
      addMediaBehavior(this, this.distribution, props.mediaBucket, props.mediaKeyGroup);
    }

    this.siteUrl =
      props.siteHostname === undefined
        ? `https://${this.distribution.distributionDomainName}`
        : `https://${props.siteHostname}`;

    new cdk.CfnOutput(this, 'SiteBucketName', { value: this.siteBucket.bucketName });
    new cdk.CfnOutput(this, 'SiteDistributionId', { value: this.distribution.distributionId });
    new cdk.CfnOutput(this, 'SiteUrl', { value: this.siteUrl });
    new cdk.CfnOutput(this, 'HttpApiUrl', { value: `${this.siteUrl}${SITE_API_PREFIX}` });
    new cdk.CfnOutput(this, 'SiteWebSocketUrl', {
      value: `${this.siteUrl.replace(/^https:/u, 'wss:')}${SITE_SOCKET_PATH}`,
    });
  }
}
