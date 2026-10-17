/**
 * Serves the HTTP API from the website distribution at `/api/*`.
 *
 * The browser calls the website host, so those requests are same-origin and do
 * not send a CORS preflight. The function strips `/api` before API Gateway.
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { ORIGIN_VERIFY_HEADER, rateLimitedWebAcl } from './api-edge';
import { SITE_API_PREFIX } from './deploy-config';

/** Inputs for {@link createSiteApiEdge}. */
export type SiteApiProps = {
  /** HTTP API execute-api hostname. CloudFront connects here. */
  executeApiDomainName: string;
  /** Secrets Manager ARN of the origin-verify secret created for the HTTP API. */
  originVerifySecretArn: string;
};

/** Edge pieces the website distribution attaches when the shared host is on. */
export type SiteApiEdge = {
  /** Firewall scoped to {@link SITE_API_PREFIX}. */
  webAcl: ReturnType<typeof rateLimitedWebAcl>;
  /** Rewrites extensionless website paths to `index.html`. */
  spaRewrite: cloudfront.Function;
  /** Strips `/api` and sets the API Host header. */
  apiRewrite: cloudfront.Function;
  /** Secret value CloudFront sends as `x-origin-verify`. */
  originVerify: string;
};

/**
 * Builds the website and `/api` edge functions, the scoped firewall, and the origin secret.
 *
 * @param scope - The website construct.
 * @param props - The API origin and the secret that proves the request came through CloudFront.
 * @returns Objects the distribution constructor and `/api/*` behavior attach.
 */
export const createSiteApiEdge = (scope: Construct, props: SiteApiProps): SiteApiEdge => {
  const region = cdk.Stack.of(scope).region;
  if (!cdk.Token.isUnresolved(region) && region !== 'us-east-1') {
    throw new Error('The website firewall must be deployed in us-east-1.');
  }

  const readSecret = new AwsCustomResource(scope, 'ReadSiteOriginVerify', {
    onCreate: {
      service: 'SecretsManager',
      action: 'getSecretValue',
      parameters: { SecretId: props.originVerifySecretArn },
      physicalResourceId: PhysicalResourceId.of(props.originVerifySecretArn),
    },
    onUpdate: {
      service: 'SecretsManager',
      action: 'getSecretValue',
      parameters: { SecretId: props.originVerifySecretArn },
      physicalResourceId: PhysicalResourceId.of(props.originVerifySecretArn),
    },
    policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [props.originVerifySecretArn] }),
  });

  const spaRewrite = new cloudfront.Function(scope, 'SpaRewrite', {
    comment: 'Serve index.html for website routes that have no file extension',
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
    request.uri = '/index.html';
  }
  return request;
}
`),
  });

  const apiRewrite = new cloudfront.Function(scope, 'ApiRewrite', {
    comment: 'Strip /api before the request reaches API Gateway',
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '${SITE_API_PREFIX}') {
    request.uri = '/';
  } else if (uri.indexOf('${SITE_API_PREFIX}/') === 0) {
    request.uri = uri.substring(${SITE_API_PREFIX.length}) || '/';
  }
  return request;
}
`),
  });

  return {
    webAcl: rateLimitedWebAcl(scope, 'SiteApiWebAcl', 'gameplan-site-api', `${SITE_API_PREFIX}/`),
    spaRewrite,
    apiRewrite,
    originVerify: readSecret.getResponseField('SecretString'),
  };
};

/**
 * Forwards `/api/*` to API Gateway.
 *
 * The viewer path keeps the prefix so it does not collide with website routes
 * such as `/teams`. The function removes it before API Gateway.
 *
 * @param distribution - The website distribution.
 * @param edge - Functions and the origin secret from {@link createSiteApiEdge}.
 * @param props - The HTTP API execute-api hostname.
 */
export const addSiteApiBehavior = (
  distribution: cloudfront.Distribution,
  edge: SiteApiEdge,
  props: SiteApiProps,
): void => {
  distribution.addBehavior(
    `${SITE_API_PREFIX}/*`,
    new origins.HttpOrigin(props.executeApiDomainName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      customHeaders: { [ORIGIN_VERIFY_HEADER]: edge.originVerify },
    }),
    {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      compress: true,
      functionAssociations: [
        {
          function: edge.apiRewrite,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        },
      ],
    },
  );
};
