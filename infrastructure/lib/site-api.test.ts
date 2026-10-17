/**
 * Unit tests for serving the website and the area function URLs from the site stack.
 */

import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { HTTP_AREAS } from './names';
import { siteStackForTest } from './test-fixtures';

describe('site stack', () => {
  it('forwards each /api area to its signed function URL and limits that prefix', () => {
    const { site } = siteStackForTest();
    const template = Template.fromStack(site);

    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 'lambda',
        SigningBehavior: 'always',
      }),
    });
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Name: 'gameplan-site-api',
      Scope: 'CLOUDFRONT',
    });

    const config = distributionConfig(template);
    expect(config.CustomErrorResponses).toBeUndefined();
    expect(config.CacheBehaviors?.map((behavior) => behavior.PathPattern)).toEqual(
      HTTP_AREAS.map((area) => `/api/${area}*`),
    );
    const apiOrigins = config.Origins.filter((origin) => origin.S3OriginConfig === undefined);
    expect(apiOrigins).toHaveLength(HTTP_AREAS.length);
    for (const origin of apiOrigins) {
      expect(origin.OriginAccessControlId).toBeDefined();
      expect(JSON.stringify(origin.DomainName)).toContain('Fn::ImportValue');
    }

    const code = Object.values(template.findResources('AWS::CloudFront::Function'))
      .map((resource) => String(resource.Properties.FunctionCode))
      .join('\n');
    expect(code).toContain('uri.substring(4)');
    expect(code).toContain("request.headers['x-viewer-authorization'] = { value: authorization.value }");
    expect(code).toContain("delete request.headers['x-viewer-authorization']");
  });

  it('lets only this distribution invoke the function URLs', () => {
    const { site } = siteStackForTest();
    const permissions = Object.values(
      Template.fromStack(site).findResources('AWS::Lambda::Permission'),
    ).filter((resource) => resource.Properties.Principal === 'cloudfront.amazonaws.com');
    expect(permissions).toHaveLength(HTTP_AREAS.length * 2);
    expect(permissions.map((permission) => permission.Properties.Action).sort()).toEqual(
      [
        ...HTTP_AREAS.map(() => 'lambda:InvokeFunction'),
        ...HTTP_AREAS.map(() => 'lambda:InvokeFunctionUrl'),
      ].sort(),
    );
    for (const permission of permissions) {
      expect(JSON.stringify(permission.Properties.SourceArn)).toContain('SiteDistribution');
    }
  });

  it('publishes /api on the website hostname', () => {
    const { site } = siteStackForTest({
      siteHostname: 'staging.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/site',
    });
    const outputs = Template.fromStack(site).toJSON().Outputs as Record<string, { Value: unknown }>;
    const httpApiUrl = Object.entries(outputs).find(([key]) => key.includes('HttpApiUrl'))?.[1];
    expect(httpApiUrl?.Value).toBe('https://staging.example.com/api');
  });
});

/** Distribution config fields these tests read. */
type DistributionConfig = {
  CacheBehaviors?: { PathPattern: string }[];
  CustomErrorResponses?: unknown[];
  Origins: { DomainName: unknown; OriginAccessControlId?: unknown; S3OriginConfig?: unknown }[];
};

/**
 * Reads the website distribution config from a synthesized template.
 *
 * @param template - The site template.
 * @returns The distribution config object.
 */
const distributionConfig = (template: Template): DistributionConfig => {
  const distributions = template.findResources('AWS::CloudFront::Distribution');
  const resource = Object.values(distributions)[0] as {
    Properties: { DistributionConfig: DistributionConfig };
  };
  return resource.Properties.DistributionConfig;
};
