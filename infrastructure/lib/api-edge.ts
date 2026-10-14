/**
 * CloudFront and AWS WAF in front of the HTTP API.
 *
 * WAF here is pay-as-you-go, not a CloudFront flat-rate plan. A rate rule can
 * count by the Authorization header, so each access token has its own limit.
 */

import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

/** Requests one access token may make in {@link WINDOW}. */
const TOKEN_LIMIT = 600;

/** Requests with no access token that one IP address may make in {@link WINDOW}. */
const ANONYMOUS_IP_LIMIT = 100;

/**
 * Requests one IP address may make in {@link WINDOW}, with or without a token.
 *
 * This stops a client from inventing a new Authorization value on every call.
 * It sits far above normal use on a shared network.
 */
const IP_FLOOD_LIMIT = 4000;

/** Rate-rule window. WAF counts requests inside this span. */
const WINDOW = cdk.Duration.minutes(5);

/**
 * Header CloudFront adds before the request reaches API Gateway.
 *
 * Must match `ORIGIN_VERIFY_HEADER` in `functions/lib/http.ts`.
 */
const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

/** Inputs for {@link attachApiEdge}. */
export type ApiEdgeProps = {
  /** HTTP API custom domain. CloudFront uses its regional hostname as the origin. */
  customDomain: apigwv2.IDomainName;
  /** Public API hostname. DNS points this name at the distribution. */
  apiHostname: string;
  /** Certificate ARN in `us-east-1` for `apiHostname`. */
  certificateArn: string;
};

/**
 * Builds a blocking rate rule that answers `429`.
 *
 * @param name - The rule name and the CloudWatch metric name.
 * @param priority - Unique priority. Lower numbers run first.
 * @param statement - The rate statement.
 * @returns A WebACL rule.
 */
const rateRule = (
  name: string,
  priority: number,
  statement: wafv2.CfnWebACL.StatementProperty,
): wafv2.CfnWebACL.RuleProperty => ({
  name,
  priority,
  action: {
    block: {
      customResponse: {
        responseCode: 429,
        customResponseBodyKey: 'RateLimited',
      },
    },
  },
  statement,
  visibilityConfig: {
    cloudWatchMetricsEnabled: true,
    metricName: name,
    sampledRequestsEnabled: true,
  },
});

/**
 * Matches requests that include an Authorization header.
 *
 * @returns A size constraint on that header.
 */
const hasAuthorization = (): wafv2.CfnWebACL.StatementProperty => ({
  sizeConstraintStatement: {
    fieldToMatch: { singleHeader: { name: 'authorization' } },
    comparisonOperator: 'GE',
    size: 1,
    textTransformations: [{ priority: 0, type: 'NONE' }],
  },
});

/**
 * Puts CloudFront and a per-token WAF in front of the HTTP API.
 *
 * @param scope - The parent construct.
 * @param props - The API domain, hostname, and certificate.
 * @returns The distribution, plus the origin header value the Lambdas must expect.
 */
export const attachApiEdge = (
  scope: Construct,
  props: ApiEdgeProps,
): { distribution: cloudfront.Distribution; originVerify: string } => {
  const region = cdk.Stack.of(scope).region;
  if (!cdk.Token.isUnresolved(region) && region !== 'us-east-1') {
    throw new Error('The API CloudFront distribution and its firewall must be deployed in us-east-1.');
  }

  const originSecret = new secretsmanager.Secret(scope, 'OriginVerifySecret', {
    description: 'Header CloudFront sends so clients cannot call API Gateway directly.',
    generateSecretString: { excludePunctuation: true, passwordLength: 32 },
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });
  const readOriginSecret = new AwsCustomResource(scope, 'ReadOriginVerifySecret', {
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

  const webAcl = new wafv2.CfnWebACL(scope, 'ApiWebAcl', {
    name: 'gameplan-api',
    scope: 'CLOUDFRONT',
    defaultAction: { allow: {} },
    customResponseBodies: {
      RateLimited: {
        contentType: 'APPLICATION_JSON',
        content: '{"error":"rate_limited"}',
      },
    },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: 'gameplan-api',
      sampledRequestsEnabled: true,
    },
    rules: [
      rateRule('PerAccessToken', 0, {
        rateBasedStatement: {
          limit: TOKEN_LIMIT,
          evaluationWindowSec: WINDOW.toSeconds(),
          aggregateKeyType: 'CUSTOM_KEYS',
          customKeys: [
            {
              header: {
                name: 'authorization',
                textTransformations: [{ priority: 0, type: 'NONE' }],
              },
            },
          ],
          scopeDownStatement: hasAuthorization(),
        },
      }),
      rateRule('PerAnonymousIp', 1, {
        rateBasedStatement: {
          limit: ANONYMOUS_IP_LIMIT,
          evaluationWindowSec: WINDOW.toSeconds(),
          aggregateKeyType: 'IP',
          scopeDownStatement: { notStatement: { statement: hasAuthorization() } },
        },
      }),
      rateRule('PerIpFlood', 2, {
        rateBasedStatement: {
          limit: IP_FLOOD_LIMIT,
          evaluationWindowSec: WINDOW.toSeconds(),
          aggregateKeyType: 'IP',
        },
      }),
    ],
  });

  const distribution = new cloudfront.Distribution(scope, 'ApiDistribution', {
    comment: 'GamePlan HTTP API',
    webAclId: webAcl.attrArn,
    domainNames: [props.apiHostname],
    certificate: acm.Certificate.fromCertificateArn(scope, 'ApiEdgeCertificate', props.certificateArn),
    httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    defaultBehavior: {
      origin: new origins.HttpOrigin(props.customDomain.regionalDomainName, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        customHeaders: { [ORIGIN_VERIFY_HEADER]: originVerify },
      }),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      compress: true,
    },
  });

  return { distribution, originVerify };
};
