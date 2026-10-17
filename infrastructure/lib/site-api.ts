/**
 * Serves the HTTP areas from the website distribution at `/api/<area>`.
 *
 * The browser calls the website host, so those requests are same-origin and do
 * not send a CORS preflight. Each area is a Lambda function URL that only
 * accepts requests CloudFront signs through origin access control (OAC).
 */

import * as cdk from 'aws-cdk-lib';
import type * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { rateLimitedWebAcl } from './api-edge';
import { SITE_API_PREFIX } from './deploy-config';
import { HTTP_AREAS, type HttpArea } from './names';

/**
 * Header the viewer function copies `Authorization` into.
 *
 * OAC replaces `Authorization` with its own signature. Must match
 * `VIEWER_AUTHORIZATION_HEADER` in `functions/lib/http.ts`.
 */
export const VIEWER_AUTHORIZATION_HEADER = 'x-viewer-authorization';

/** Viewer path for WebSocket connects on the website host. */
export const SITE_SOCKET_PATH = `${SITE_API_PREFIX}/socket`;

/**
 * Header CloudFront adds to each socket connect.
 *
 * Must match `ORIGIN_VERIFY_HEADER` in `functions/socket/src/authorize.ts`.
 */
export const SOCKET_ORIGIN_VERIFY_HEADER = 'x-origin-verify';

/** WebSocket API the website distribution forwards {@link SITE_SOCKET_PATH} to. */
export type SiteSocketProps = {
  /** The delivery-only WebSocket API. */
  webSocketApi: apigwv2.IWebSocketApi;
  /** Stage the connect is rewritten to. */
  stageName: string;
  /**
   * Parameter Store String whose value is sent in {@link SOCKET_ORIGIN_VERIFY_HEADER}.
   *
   * CloudFormation resolves it on each deploy, so a new value needs a site deploy.
   */
  originSecretParameter: string;
};

/** Area functions and the WebSocket API the website distribution forwards `/api` to. */
export type SiteApiProps = {
  /** Function URL for each HTTP area. Each must use `AWS_IAM` auth. */
  functionUrls: Record<HttpArea, lambda.IFunctionUrl>;
  /** Function behind each URL. The distribution gets permission to invoke it. */
  functions: Record<HttpArea, lambda.IFunction>;
  /** WebSocket API for live delivery. */
  socket: SiteSocketProps;
};

/** Edge pieces the website distribution attaches when the shared host is on. */
export type SiteApiEdge = {
  /** Firewall scoped to {@link SITE_API_PREFIX}. */
  webAcl: ReturnType<typeof rateLimitedWebAcl>;
  /** Rewrites extensionless website paths to `index.html`. */
  spaRewrite: cloudfront.Function;
  /** Strips `/api` and moves the bearer token out of `Authorization`. */
  apiRewrite: cloudfront.Function;
  /** Points socket connects at the WebSocket stage path. */
  socketRewrite: cloudfront.Function;
  /** Signs every origin request to the function URLs. */
  originAccessControl: cloudfront.FunctionUrlOriginAccessControl;
};

/**
 * Builds the website and `/api` edge functions, the scoped firewall, and the OAC.
 *
 * @param scope - The website construct.
 * @returns Objects the distribution constructor and `/api` behaviors attach.
 */
export const createSiteApiEdge = (scope: Construct, stageName: string): SiteApiEdge => {
  const region = cdk.Stack.of(scope).region;
  if (!cdk.Token.isUnresolved(region) && region !== 'us-east-1') {
    throw new Error('The website firewall must be deployed in us-east-1.');
  }

  const spaRewrite = new cloudfront.Function(scope, 'SpaRewrite', {
    comment: 'Serve index.html for website routes that have no file extension',
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '${SITE_API_PREFIX}' || uri.indexOf('${SITE_API_PREFIX}/') === 0) {
    return {
      statusCode: 404,
      statusDescription: 'Not Found',
      headers: { 'content-type': { value: 'application/json' } },
      body: '{"error":"not_found"}',
    };
  }
  if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
    request.uri = '/index.html';
  }
  return request;
}
`),
  });

  // Viewers cannot set the copy themselves: it is replaced or removed on every request.
  const apiRewrite = new cloudfront.Function(scope, 'ApiRewrite', {
    comment: 'Strip /api and keep the bearer token past the OAC signature',
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('${SITE_API_PREFIX}/') === 0) {
    request.uri = uri.substring(${SITE_API_PREFIX.length});
  }
  var authorization = request.headers.authorization;
  if (authorization) {
    request.headers['${VIEWER_AUTHORIZATION_HEADER}'] = { value: authorization.value };
  } else {
    delete request.headers['${VIEWER_AUTHORIZATION_HEADER}'];
  }
  return request;
}
`),
  });

  // A WebSocket API only accepts connects on the stage path itself.
  const socketRewrite = new cloudfront.Function(scope, 'SocketRewrite', {
    comment: 'Send /api/socket connects to the WebSocket stage',
    runtime: cloudfront.FunctionRuntime.JS_2_0,
    code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  request.uri = '/${stageName}';
  return request;
}
`),
  });

  return {
    webAcl: rateLimitedWebAcl(scope, 'SiteApiWebAcl', 'gameplan-site-api', `${SITE_API_PREFIX}/`, SITE_SOCKET_PATH),
    spaRewrite,
    apiRewrite,
    socketRewrite,
    originAccessControl: new cloudfront.FunctionUrlOriginAccessControl(scope, 'ApiOriginAccess', {
      description: 'Signs website requests to the GamePlan area function URLs',
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    }),
  };
};

/**
 * Grants one distribution, and nothing else, access to one function URL.
 *
 * Lambda needs both actions for a function URL call signed by CloudFront.
 *
 * @param scope - The construct that owns the permissions.
 * @param area - The HTTP area, used in the construct ids.
 * @param fn - The area function.
 * @param distribution - The website distribution.
 */
const allowDistribution = (
  scope: Construct,
  area: HttpArea,
  fn: lambda.IFunction,
  distribution: cloudfront.IDistribution,
): void => {
  const sourceArn = distribution.distributionArn;
  new lambda.CfnPermission(scope, `${area}UrlFromSite`, {
    action: 'lambda:InvokeFunctionUrl',
    functionName: fn.functionArn,
    principal: 'cloudfront.amazonaws.com',
    sourceArn,
    functionUrlAuthType: lambda.FunctionUrlAuthType.AWS_IAM,
  });
  new lambda.CfnPermission(scope, `${area}InvokeFromSite`, {
    action: 'lambda:InvokeFunction',
    functionName: fn.functionArn,
    principal: 'cloudfront.amazonaws.com',
    sourceArn,
    invokedViaFunctionUrl: true,
  });
};

/**
 * Forwards `/api/<area>` and `/api/<area>/*` to that area's function URL, and
 * {@link SITE_SOCKET_PATH} to the WebSocket API.
 *
 * The viewer path keeps the prefix so it does not collide with website routes
 * such as `/teams`. The function removes it before the request reaches Lambda.
 * The permissions live with the distribution so the API stack never references it.
 *
 * @param distribution - The website distribution.
 * @param edge - Functions and the OAC from {@link createSiteApiEdge}.
 * @param props - Function URLs and functions by area.
 */
export const addSiteApiBehaviors = (
  distribution: cloudfront.Distribution,
  edge: SiteApiEdge,
  props: SiteApiProps,
): void => {
  for (const area of HTTP_AREAS) {
    allowDistribution(distribution, area, props.functions[area], distribution);
    const domain = cdk.Fn.select(2, cdk.Fn.split('/', props.functionUrls[area].url));
    distribution.addBehavior(
      `${SITE_API_PREFIX}/${area}*`,
      new origins.HttpOrigin(domain, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        originAccessControlId: edge.originAccessControl.originAccessControlId,
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
  }

  // The viewer Host must not reach API Gateway, which routes on its own hostname.
  // Every other header and the `ticket` query string pass through for the upgrade.
  const socket = props.socket;
  distribution.addBehavior(
    SITE_SOCKET_PATH,
    new origins.HttpOrigin(cdk.Fn.select(2, cdk.Fn.split('/', socket.webSocketApi.apiEndpoint)), {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      customHeaders: {
        [SOCKET_ORIGIN_VERIFY_HEADER]: ssm.StringParameter.valueForStringParameter(
          distribution,
          socket.originSecretParameter,
        ),
      },
    }),
    {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      functionAssociations: [
        {
          function: edge.socketRewrite,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        },
      ],
    },
  );
};
