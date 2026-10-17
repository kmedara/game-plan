/**
 * Unit tests for serving the HTTP API from the website distribution.
 */

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GamePlanPlatform } from './gameplan-stack';

const platformProps = {
  corsOrigin: 'https://app.example.com',
  callbackUrls: ['https://app.example.com/api/identity/oauth/callback'],
  logoutUrls: ['https://app.example.com/login'],
};

describe('website API behavior', () => {
  it('keeps API traffic off the website distribution until the origin is known', () => {
    const app = new cdk.App();
    const stack = new GamePlanPlatform(app, 'GamePlanPlatform', platformProps);
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::WAFv2::WebACL', 0);
    const config = distributionConfig(template);
    expect(config.CacheBehaviors).toBeUndefined();
    expect(config.CustomErrorResponses).toHaveLength(2);
  });

  it('forwards /api to API Gateway and limits that prefix', () => {
    const app = new cdk.App();
    const stack = new GamePlanPlatform(app, 'GamePlanPlatform', {
      ...platformProps,
      sharedApi: {
        executeApiDomainName: 'abc123.execute-api.us-east-1.amazonaws.com',
        originVerifySecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:origin-AbCdEf',
      },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([Match.objectLike({ PathPattern: '/api/*' })]),
      }),
    });
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Name: 'gameplan-site-api',
      Scope: 'CLOUDFRONT',
    });
    const config = distributionConfig(template);
    expect(config.CustomErrorResponses).toBeUndefined();
    const code = Object.values(template.findResources('AWS::CloudFront::Function'))
      .map((resource) => String(resource.Properties.FunctionCode))
      .join('\n');
    expect(code).not.toContain('updateRequestOrigin');
    expect(code).toContain('uri.substring(4)');
  });
});

/**
 * Reads the website distribution config from a synthesized template.
 *
 * @param template - The platform template.
 * @returns The distribution config object.
 */
const distributionConfig = (template: Template): { CacheBehaviors?: unknown; CustomErrorResponses?: unknown[] } => {
  const distributions = template.findResources('AWS::CloudFront::Distribution');
  const resource = Object.values(distributions)[0] as {
    Properties: { DistributionConfig: { CacheBehaviors?: unknown; CustomErrorResponses?: unknown[] } };
  };
  return resource.Properties.DistributionConfig;
};
