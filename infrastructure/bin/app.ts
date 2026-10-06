#!/usr/bin/env node
/**
 * CDK application entry for the GamePlan stack.
 *
 * Instantiates {@link GamePlanStack} with the caller account and region.
 * Cognito OAuth callback/logout URLs and optional social IdP credentials come
 * from CDK context. `CLIENT_ORIGIN` overrides the local Angular CORS default.
 */

import * as cdk from 'aws-cdk-lib';
import { getStackEnv } from '../lib/stack-env';
import { GamePlanStack } from '../lib/gameplan-stack';

/** Root CDK app. */
const app = new cdk.App();

const callbackUrls = (app.node.tryGetContext('callbackUrls') as string[] | undefined) ?? [
  'http://localhost:3000/identity/oauth/callback',
];
const logoutUrls = (app.node.tryGetContext('logoutUrls') as string[] | undefined) ?? [
  'http://localhost:4200/',
  'http://localhost:4200/login',
];

const social = {
  googleClientId: app.node.tryGetContext('googleClientId') as string | undefined,
  googleClientSecret: app.node.tryGetContext('googleClientSecret') as string | undefined,
  facebookAppId: app.node.tryGetContext('facebookAppId') as string | undefined,
  facebookAppSecret: app.node.tryGetContext('facebookAppSecret') as string | undefined,
  appleClientId: app.node.tryGetContext('appleClientId') as string | undefined,
  appleTeamId: app.node.tryGetContext('appleTeamId') as string | undefined,
  appleKeyId: app.node.tryGetContext('appleKeyId') as string | undefined,
  applePrivateKey: app.node.tryGetContext('applePrivateKey') as string | undefined,
};

new GamePlanStack(app, 'GamePlanStack', {
  env: getStackEnv(),
  corsOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:4200',
  callbackUrls,
  logoutUrls,
  social,
});
