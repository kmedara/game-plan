/**
 * Unit test that the HTTP API keeps its default execute-api endpoint turned on.
 *
 * The website distribution connects to that hostname. A stack that omits the
 * property leaves an earlier `true` in place, so the template must say `false`.
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { GamePlanApi, GamePlanPlatform } from './gameplan-stack';

describe('http api endpoint', () => {
  it('keeps the execute-api endpoint enabled for the website distribution', () => {
    const app = new cdk.App();
    const platform = new GamePlanPlatform(app, 'GamePlanPlatform', {
      corsOrigin: 'https://staging.example.com',
      callbackUrls: ['https://staging.example.com/api/identity/oauth/callback'],
      logoutUrls: ['https://staging.example.com/login'],
    });
    const stack = new GamePlanApi(app, 'GamePlanApi', {
      corsOrigin: 'https://staging.example.com',
      authCallbackUrl: 'https://staging.example.com/api/identity/oauth/callback',
      userPool: platform.userPool,
      userPoolClient: platform.userPoolClient,
      hostedUiDomain: platform.hostedUiDomain,
      table: platform.table,
      mediaBucket: platform.mediaBucket,
      distribution: platform.distribution,
    });
    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      DisableExecuteApiEndpoint: false,
    });
    // Synthesizing the API stack bundles every area Lambda.
  }, 120_000);
});
