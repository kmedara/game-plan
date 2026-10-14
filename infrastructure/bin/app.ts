#!/usr/bin/env node
/**
 * CDK application entry for the GamePlan stack.
 *
 * Instantiates {@link GamePlanStack} with the caller account and region.
 * Cognito OAuth callback/logout URLs and optional social IdP credentials come
 * from CDK context, then from process environment (Parameter Store in CI).
 * `CLIENT_ORIGIN` overrides the local Angular CORS default.
 */

import * as cdk from 'aws-cdk-lib';
import { definedString, splitUrlList, urlListFromUnknown } from '../lib/deploy-config';
import { getStackEnv } from '../lib/stack-env';
import { GamePlanStack } from '../lib/gameplan-stack';

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

const callbackUrls = urlListFromUnknown(app.node.tryGetContext('callbackUrls')) ??
  splitUrlList(process.env.CALLBACK_URLS) ?? ['http://localhost:3000/identity/oauth/callback'];
const logoutUrls = urlListFromUnknown(app.node.tryGetContext('logoutUrls')) ??
  splitUrlList(process.env.LOGOUT_URLS) ?? ['http://localhost:4200/', 'http://localhost:4200/login'];

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

new GamePlanStack(app, 'GamePlanStack', {
  env: getStackEnv(),
  corsOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:4200',
  callbackUrls,
  logoutUrls,
  social,
});
