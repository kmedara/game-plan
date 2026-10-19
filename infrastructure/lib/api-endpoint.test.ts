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
      ssmPrefix: '/gameplan',
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'WEBSOCKET' });

    // Every area URL is IAM-only. The Stripe webhook is the one public URL,
    // and it belongs to a function that serves only that route.
    const urls = Object.values(template.findResources('AWS::Lambda::Url'));
    const publicUrls = urls.filter((url) => url.Properties.AuthType === 'NONE');
    expect(urls).toHaveLength(HTTP_AREAS.length + 1);
    expect(publicUrls).toHaveLength(1);
    expect(JSON.stringify(publicUrls[0]?.Properties.TargetFunctionArn)).toContain('paymentswebhook');
    for (const url of urls.filter((candidate) => !publicUrls.includes(candidate))) {
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

    // Clients connect through the website distribution, so the client build never reads the execute-api URL.
    const outputKeys = Object.keys(template.toJSON().Outputs as object);
    const outputs = envFromOutputs({ GamePlanApi: Object.fromEntries(outputKeys.map((key) => [key, 'value'])) });
    expect(Object.keys(outputs)).toEqual([]);

    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      IdentitySource: ['route.request.querystring.ticket', 'route.request.header.X-Origin-Verify'],
    });
    // Secrets reach the functions as parameter names. The values are read at run time.
    const secretVariables = [
      'ORIGIN_VERIFY_SECRET',
      'VAPID_PRIVATE_KEY',
      'GOOGLE_MAPS_API_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ];
    for (const fn of Object.values(template.findResources('AWS::Lambda::Function'))) {
      const variables = Object.keys(fn.Properties.Environment?.Variables ?? {});
      expect(variables.filter((name) => secretVariables.includes(name))).toEqual([]);
    }
    const parameterNames: Record<string, [string, string]> = {
      'gameplan-socket-authorizer': ['ORIGIN_VERIFY_SECRET_PARAMETER', '/gameplan/socket-origin-verify'],
      'gameplan-fanout': ['VAPID_PRIVATE_KEY_PARAMETER', '/gameplan/vapid-private-key'],
      'gameplan-places': ['GOOGLE_MAPS_API_KEY_PARAMETER', '/gameplan/google-maps-api-key'],
      'gameplan-payments': ['STRIPE_SECRET_KEY_PARAMETER', '/gameplan/stripe-secret-key'],
      'gameplan-payments-webhook': ['STRIPE_WEBHOOK_SECRET_PARAMETER', '/gameplan/stripe-webhook-secret'],
    };
    for (const [functionName, [variable, parameter]] of Object.entries(parameterNames)) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        Environment: { Variables: Match.objectLike({ [variable]: parameter, NODE_ENV: 'production' }) },
      });
    }
    const parameterReads = Object.values(template.findResources('AWS::IAM::Policy'))
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[])
      .filter((statement) => statement.Action === 'ssm:GetParameter')
      .map((statement) => JSON.stringify(statement.Resource));
    // Payments and its webhook each read the Stripe key and the webhook secret.
    expect(parameterReads).toHaveLength(7);
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/stripe-secret-key');
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/stripe-webhook-secret');
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/vapid-private-key');
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/google-maps-api-key');
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/socket-origin-verify');
    template.resourceCountIs('AWS::SecretsManager::Secret', 0);
    // Synthesizing the API stack bundles every area Lambda.
  }, 120_000);
});
