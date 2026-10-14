#!/usr/bin/env node
/**
 * CDK application entry for the GamePlan stacks.
 *
 * Instantiates DNS, platform, and API stacks in the caller account and region.
 * Cognito OAuth callback/logout URLs and optional social IdP credentials come
 * from CDK context, then from process environment. In CI, `DEPLOY_ENV` and
 * `HOSTED_ZONE_NAME` choose `app.<environment>.<zone>` and `api.<environment>.<zone>`.
 * `CLIENT_ORIGIN` overrides the local website CORS default. A hosted zone id
 * adds the DNS stack and connects the website and API hostnames to it.
 */

import * as cdk from 'aws-cdk-lib';
import { definedString, hostnameOf, publicUrlsFor, splitUrlList, urlListFromUnknown } from '../lib/deploy-config';
import { GamePlanApi, GamePlanDns, GamePlanPlatform } from '../lib/gameplan-stack';
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

const callbackUrls = derived !== undefined
  ? [derived.callbackUrl]
  : (urlListFromUnknown(app.node.tryGetContext('callbackUrls')) ??
    splitUrlList(process.env.CALLBACK_URLS) ?? ['http://localhost:3000/identity/oauth/callback']);
const logoutUrls = derived !== undefined
  ? [derived.logoutUrl]
  : (urlListFromUnknown(app.node.tryGetContext('logoutUrls')) ??
    splitUrlList(process.env.LOGOUT_URLS) ?? ['http://localhost:4200/', 'http://localhost:4200/login']);

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
const apiHostname = derived?.apiHostname ?? hostnameOf(callbackUrls[0]);
if (hostedZoneId !== undefined && (siteHostname === undefined || apiHostname === undefined)) {
  throw new Error('HOSTED_ZONE_ID requires HOSTED_ZONE_NAME and DEPLOY_ENV');
}

const env = getStackEnv();
const corsOrigin = derived?.clientOrigin ?? definedString(process.env.CLIENT_ORIGIN) ?? 'http://localhost:4200';
const dns =
  hostedZoneId === undefined || siteHostname === undefined || apiHostname === undefined
    ? undefined
    : {
        hostedZoneId,
        roleArn: definedString(process.env.HOSTED_ZONE_ROLE_ARN),
        siteHostname,
        apiHostname,
      };

const dnsStack = dns === undefined ? undefined : new GamePlanDns(app, 'GamePlanDns', { env, ...dns });

const platform = new GamePlanPlatform(app, 'GamePlanPlatform', {
  env,
  corsOrigin,
  callbackUrls,
  logoutUrls,
  social,
  siteHostname: dns?.siteHostname,
  certificateArn: dnsStack?.siteCertificateArn,
});

new GamePlanApi(app, 'GamePlanApi', {
  env,
  corsOrigin,
  authCallbackUrl: callbackUrls[0]!,
  userPool: platform.userPool,
  userPoolClient: platform.userPoolClient,
  hostedUiDomain: platform.hostedUiDomain,
  table: platform.table,
  mediaBucket: platform.mediaBucket,
  distribution: platform.distribution,
  certificateArn: dnsStack?.apiCertificateArn,
  dns,
});
