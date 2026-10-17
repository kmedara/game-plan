/**
 * Unit tests for the area function URLs on the API stack.
 */

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GamePlanApi, GamePlanPlatform } from './gameplan-stack';
import { HTTP_AREAS } from './names';
import { envFromOutputs } from './ssm-parameters';

describe('area function urls', () => {
  it('require IAM, leave the distribution to the site stack, and verify Cognito tokens', () => {
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
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'WEBSOCKET' });

    const urls = Object.values(template.findResources('AWS::Lambda::Url'));
    expect(urls).toHaveLength(HTTP_AREAS.length);
    for (const url of urls) {
      expect(url.Properties.AuthType).toBe('AWS_IAM');
    }

    // The site stack grants CloudFront. A reference here would make the stacks depend on each other.
    const permissions = Object.values(template.findResources('AWS::Lambda::Permission')).filter(
      (resource) => resource.Properties.Principal === 'cloudfront.amazonaws.com',
    );
    expect(permissions).toHaveLength(0);
    expect(JSON.stringify(template.toJSON())).not.toContain('Distribution');

    for (const area of HTTP_AREAS) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `gameplan-${area}`,
        Environment: {
          Variables: Match.objectLike({
            COGNITO_USER_POOL_ID: Match.anyValue(),
            COGNITO_CLIENT_ID: Match.anyValue(),
          }),
        },
      });
    }

    const outputKeys = Object.keys(template.toJSON().Outputs as object);
    const outputs = envFromOutputs({ GamePlanApi: Object.fromEntries(outputKeys.map((key) => [key, 'value'])) });
    expect(Object.keys(outputs)).toEqual(['WS_BASE_URL']);
    // Synthesizing the API stack bundles every area Lambda.
  }, 120_000);
});
