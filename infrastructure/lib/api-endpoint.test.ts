/**
 * Unit tests for the area function URLs on the API stack.
 */

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GamePlanApi, GamePlanPlatform } from './gameplan-stack';
import { HTTP_AREAS } from './names';
import { stripeWebhookUrlAllowSids } from './lambda-url-policy';
import { stripeWebhookSourceCidrs } from './stripe-webhook-ips';
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

    // Every area URL is IAM-only. The two Stripe webhooks and the CSP report
    // sink are the only public URLs, each on a function that serves only that route.
    const urls = Object.values(template.findResources('AWS::Lambda::Url'));
    const publicUrls = urls.filter((url) => url.Properties.AuthType === 'NONE');
    expect(urls).toHaveLength(HTTP_AREAS.length + 3);
    const publicTargets = publicUrls.map((url) => JSON.stringify(url.Properties.TargetFunctionArn)).join(' ');
    expect(publicTargets).toMatch(/paymentswebhook/u);
    expect(publicTargets).toMatch(/billingwebhook/u);
    expect(publicTargets).toMatch(/cspreport/iu);
    expect(publicUrls).toHaveLength(3);
    for (const url of urls.filter((candidate) => !publicUrls.includes(candidate))) {
      expect(url.Properties.AuthType).toBe('AWS_IAM');
    }

    // Each webhook URL is open only to Stripe's IPs, through a full resource
    // policy. The URL's own unconditioned permissions must be gone.
    const webhookPolicies = Object.values(template.findResources('AWS::Lambda::ResourcePolicy'));
    expect(webhookPolicies).toHaveLength(2);
    for (const policy of webhookPolicies) {
      const statements = policy.Properties.PolicyDocument.Statement as Array<{ Sid: string; Condition: unknown }>;
      expect(statements.map((statement) => statement.Sid)).toEqual([...stripeWebhookUrlAllowSids]);
      for (const statement of statements) {
        expect(statement.Condition).toMatchObject({ IpAddress: { 'aws:SourceIp': [...stripeWebhookSourceCidrs()] } });
      }
    }
    const webhookPermissions = Object.values(template.findResources('AWS::Lambda::Permission')).filter(
      (resource) => /webhook/iu.test(JSON.stringify(resource.Properties.FunctionName)),
    );
    expect(webhookPermissions).toHaveLength(0);

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
      'STRIPE_BILLING_WEBHOOK_SECRET',
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
      'gameplan-stripe-payments-webhook': ['STRIPE_WEBHOOK_SECRET_PARAMETER', '/gameplan/stripe-webhook-secret'],
      'gameplan-billing': ['STRIPE_SECRET_KEY_PARAMETER', '/gameplan/stripe-secret-key'],
      'gameplan-orgs': ['STRIPE_SECRET_KEY_PARAMETER', '/gameplan/stripe-secret-key'],
      'gameplan-stripe-billing-webhook': [
        'STRIPE_BILLING_WEBHOOK_SECRET_PARAMETER',
        '/gameplan/stripe-billing-webhook-secret',
      ],
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
    // Payments and its webhook read the Stripe key and the Connect webhook secret.
    // Billing reads the key; its webhook reads the key and the billing webhook secret.
    // Orgs reads the key to keep the extra-team quantity in step.
    expect(parameterReads).toHaveLength(11);
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/stripe-billing-webhook-secret');
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/stripe-secret-key');
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/stripe-webhook-secret');
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/vapid-private-key');
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/google-maps-api-key');
    expect(parameterReads.join('\n')).toContain('parameter/gameplan/socket-origin-verify');
    template.resourceCountIs('AWS::SecretsManager::Secret', 0);
    // Synthesizing the API stack bundles every area Lambda.
  }, 120_000);
});
