/**
 * AWS WAF rules for the HTTP API.
 *
 * WAF here is pay-as-you-go, not a CloudFront flat-rate plan. A rate rule can
 * count by the Authorization header, so each access token has its own limit.
 * The website distribution attaches these rules to `/api/`.
 */

import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

/** Requests one access token may make in {@link WINDOW}. */
const TOKEN_LIMIT = 600;

/** Requests with no access token that one IP address may make in {@link WINDOW}. */
const ANONYMOUS_IP_LIMIT = 100;

/**
 * WebSocket connects one IP address may open in {@link WINDOW}.
 *
 * A connect carries a one-time ticket instead of an Authorization header. Each
 * phone reconnects whenever the app returns to the foreground, so a team on one
 * network needs more room than the anonymous limit gives.
 */
const SOCKET_CONNECT_IP_LIMIT = 1000;

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
    fieldToMatch: {
      // Nested WAF statements keep a lowercase `name` unless this key is already `Name`.
      singleHeader: { Name: 'authorization' } as unknown as wafv2.CfnWebACL.SingleHeaderProperty,
    },
    comparisonOperator: 'GE',
    size: 1,
    textTransformations: [{ priority: 0, type: 'NONE' }],
  },
});

/**
 * Matches a viewer path prefix, such as `/api/` on the website distribution.
 *
 * @param prefix - The path prefix, including the leading slash.
 * @returns A byte-match statement.
 */
const uriStartsWith = (prefix: string): wafv2.CfnWebACL.StatementProperty => ({
  byteMatchStatement: {
    searchString: prefix,
    fieldToMatch: { uriPath: {} },
    positionalConstraint: 'STARTS_WITH',
    textTransformations: [{ priority: 0, type: 'NONE' }],
  },
});

/**
 * Matches one exact viewer path, such as the WebSocket connect path.
 *
 * @param path - The full path, including the leading slash.
 * @returns A byte-match statement.
 */
const uriIs = (path: string): wafv2.CfnWebACL.StatementProperty => ({
  byteMatchStatement: {
    searchString: path,
    fieldToMatch: { uriPath: {} },
    positionalConstraint: 'EXACTLY',
    textTransformations: [{ priority: 0, type: 'NONE' }],
  },
});

/**
 * Combines scope-down statements. One statement is returned as itself.
 *
 * @param statements - Statements to require. Blank entries are skipped.
 * @returns The combined statement, or `undefined` when nothing was required.
 */
const allOf = (
  statements: readonly (wafv2.CfnWebACL.StatementProperty | undefined)[],
): wafv2.CfnWebACL.StatementProperty | undefined => {
  const present = statements.filter((statement) => statement !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return { andStatement: { statements: present } };
};

/**
 * Builds the rate rules for the website distribution's API paths.
 *
 * @param pathPrefix - When set, only paths with this prefix count. The website
 *   distribution uses `/api/` so static files stay outside the limits.
 * @param socketPath - When set, WebSocket connects on this exact path get their
 *   own per-IP limit instead of the anonymous one.
 * @returns WebACL rules in priority order.
 */
export const apiRateLimitRules = (
  pathPrefix?: string,
  socketPath?: string,
): wafv2.CfnWebACL.RuleProperty[] => {
  const prefix = pathPrefix === undefined ? undefined : uriStartsWith(pathPrefix);
  const socket = socketPath === undefined ? undefined : uriIs(socketPath);
  const anonymous = { notStatement: { statement: hasAuthorization() } };
  const notSocket = socket === undefined ? undefined : { notStatement: { statement: socket } };
  const socketRules =
    socket === undefined
      ? []
      : [
          rateRule('SocketConnectIp', 2, {
            rateBasedStatement: {
              limit: SOCKET_CONNECT_IP_LIMIT,
              evaluationWindowSec: WINDOW.toSeconds(),
              aggregateKeyType: 'IP',
              scopeDownStatement: socket,
            },
          }),
        ];
  return [
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
        scopeDownStatement: allOf([hasAuthorization(), prefix]),
      },
    }),
    rateRule('PerAnonymousIp', 1, {
      rateBasedStatement: {
        limit: ANONYMOUS_IP_LIMIT,
        evaluationWindowSec: WINDOW.toSeconds(),
        aggregateKeyType: 'IP',
        scopeDownStatement: allOf([anonymous, prefix, notSocket]),
      },
    }),
    ...socketRules,
    rateRule('PerIpFlood', 3, {
      rateBasedStatement: {
        limit: IP_FLOOD_LIMIT,
        evaluationWindowSec: WINDOW.toSeconds(),
        aggregateKeyType: 'IP',
        ...(prefix === undefined ? {} : { scopeDownStatement: prefix }),
      },
    }),
  ];
};

/**
 * Creates a CloudFront WebACL that answers `429` after the shared rate limits.
 *
 * @param scope - The parent construct.
 * @param id - The construct id. This becomes part of the logical id.
 * @param name - The WebACL name and the top-level metric name.
 * @param pathPrefix - Optional viewer path prefix. See {@link apiRateLimitRules}.
 * @param socketPath - Optional WebSocket connect path. See {@link apiRateLimitRules}.
 * @returns The WebACL.
 */
export const rateLimitedWebAcl = (
  scope: Construct,
  id: string,
  name: string,
  pathPrefix?: string,
  socketPath?: string,
): wafv2.CfnWebACL =>
  new wafv2.CfnWebACL(scope, id, {
    name,
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
      metricName: name,
      sampledRequestsEnabled: true,
    },
    rules: apiRateLimitRules(pathPrefix, socketPath),
  });
