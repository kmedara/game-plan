#!/usr/bin/env node
/**
 * CDK application entry for the GamePlan stacks.
 *
 * Instantiates DNS, platform, API, and site stacks in the caller account and region.
 * Cognito OAuth callback/logout URLs and optional social IdP credentials come
 * from CDK context, then from process environment. In CI, `DEPLOY_ENV` and
 * `HOSTED_ZONE_NAME` choose `<environment>.<zone>`. The HTTP areas are `/api`
 * on that host. `CLIENT_ORIGIN` overrides the local website CORS default. A
 * hosted zone id adds the DNS stack and connects the website hostname to it.
 */

import * as cdk from 'aws-cdk-lib';
import { definedString, hostnameOf, publicUrlsFor, siteApiBaseUrl, splitUrlList, urlListFromUnknown } from '../lib/deploy-config';
import { GamePlanApi, GamePlanDns, GamePlanPlatform, GamePlanSite } from '../lib/gameplan-stack';
import { getStackEnv } from '../lib/stack-env';

/** Root CDK app. */
const app = new cdk.App();

/**
 * Uses a CDK context string when one is set, otherwise the matching environment variable.
 *
 * @param contextKey - Context key such as `googleClientId`.
 * @param envKey - Environment variable such as `GOOGLE_CLIENT_ID`.
 * @returns The first non-blank value.
 */
const contextOrEnv = (contextKey: string, envKey: string): string | undefined =>
  definedString(app.node.tryGetContext(contextKey)) ?? definedString(process.env[envKey]);

const domain = definedString(process.env.HOSTED_ZONE_NAME) ?? definedString(process.env.DOMAIN);
const deployEnv = definedString(process.env.DEPLOY_ENV);
const derived = domain !== undefined && deployEnv !== undefined ? publicUrlsFor(deployEnv, domain) : undefined;

const localCallback = 'http://localhost:4200/api/identity/oauth/callback';
const legacyLocalCallback = 'http://localhost:3000/identity/oauth/callback';
const localLogout = 'http://localhost:4200/login';
const siteApiBase = derived === undefined ? undefined : siteApiBaseUrl(derived.clientOrigin);
const siteCallback = siteApiBase === undefined ? undefined : `${siteApiBase}/identity/oauth/callback`;
const callbackUrls =
  derived !== undefined && siteCallback !== undefined
    ? [
        ...new Set([siteCallback, localCallback, legacyLocalCallback]),
      ]
    : (urlListFromUnknown(app.node.tryGetContext('callbackUrls')) ??
      splitUrlList(process.env.CALLBACK_URLS) ?? [localCallback, legacyLocalCallback]);
const logoutUrls = derived !== undefined
  ? [derived.logoutUrl, localLogout]
  : (urlListFromUnknown(app.node.tryGetContext('logoutUrls')) ??
    splitUrlList(process.env.LOGOUT_URLS) ?? ['http://localhost:4200/', localLogout]);

const social = {
  googleClientId: contextOrEnv('googleClientId', 'GOOGLE_CLIENT_ID'),
  googleClientSecret: contextOrEnv('googleClientSecret', 'GOOGLE_CLIENT_SECRET'),
  facebookAppId: contextOrEnv('facebookAppId', 'FACEBOOK_APP_ID'),
  facebookAppSecret: contextOrEnv('facebookAppSecret', 'FACEBOOK_APP_SECRET'),
  appleClientId: contextOrEnv('appleClientId', 'APPLE_CLIENT_ID'),
  appleTeamId: contextOrEnv('appleTeamId', 'APPLE_TEAM_ID'),
  appleKeyId: contextOrEnv('appleKeyId', 'APPLE_KEY_ID'),
  applePrivateKey: contextOrEnv('applePrivateKey', 'APPLE_PRIVATE_KEY'),
};

const hostedZoneId = definedString(process.env.HOSTED_ZONE_ID);
const siteHostname = derived?.siteHostname ?? hostnameOf(definedString(process.env.CLIENT_ORIGIN));
if (hostedZoneId !== undefined && siteHostname === undefined) {
  throw new Error('HOSTED_ZONE_ID requires HOSTED_ZONE_NAME and DEPLOY_ENV');
}

const env = getStackEnv();
const corsOrigin = derived?.clientOrigin ?? definedString(process.env.CLIENT_ORIGIN) ?? 'http://localhost:4200';
const dns =
  hostedZoneId === undefined || siteHostname === undefined
    ? undefined
    : {
        hostedZoneId,
        siteHostname,
      };

const dnsStack = dns === undefined ? undefined : new GamePlanDns(app, 'GamePlanDns', { env, ...dns });

const staging = deployEnv === 'staging';
const ssmPrefix = (process.env.SSM_PREFIX ?? '/gameplan').replace(/\/+$/u, '');
// Signed, edge-cached media URLs. The private key stays in Parameter Store for the media function.
const mediaSigningPublicKey = definedString(process.env.MEDIA_SIGNING_PUBLIC_KEY);

const platform = new GamePlanPlatform(app, 'GamePlanPlatform', {
  env,
  corsOrigin,
  callbackUrls,
  logoutUrls,
  social,
  signupAllowlistParameter: staging ? `${ssmPrefix}/staging-signup-allowlist` : undefined,
  mediaCdn: mediaSigningPublicKey !== undefined,
});

const api = new GamePlanApi(app, 'GamePlanApi', {
  env,
  corsOrigin,
  authCallbackUrl: callbackUrls[0]!,
  userPool: platform.userPool,
  userPoolClient: platform.userPoolClient,
  hostedUiDomain: platform.hostedUiDomain,
  table: platform.table,
  mediaBucket: platform.mediaBucket,
  ssmPrefix,
  mediaSigningPublicKey,
});

new GamePlanSite(app, 'GamePlanSite', {
  env,
  siteHostname: dns?.siteHostname,
  certificateArn: definedString(process.env.SITE_CERTIFICATE_ARN) ?? dnsStack?.currentCertificateArn,
  dns,
  functionUrls: api.functionUrls,
  functions: api.httpFunctions,
  cspReportUrl: api.cspReportUrl,
  socket: api.socket,
  mediaBucket: platform.mediaBucket,
  mediaKeyGroup: api.mediaKeyGroup,
});
