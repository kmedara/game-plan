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
    expect(config.CacheBehaviors?.map((behavior) => behavior.PathPattern)).toEqual([
      ...HTTP_AREAS.map((area) => `/api/${area}*`),
      '/api/csp-report',
      '/api/socket',
    ]);
    // The CSP report origin is unsigned on purpose: browsers cannot hash a report body.
    const apiOrigins = config.Origins.filter(
      (origin) =>
        origin.S3OriginConfig === undefined &&
        origin.OriginCustomHeaders === undefined &&
        !JSON.stringify(origin.DomainName).includes('cspReport'),
    );
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

  it('serves index.html for app routes but leaves files and app-link files alone', () => {
    const { site } = siteStackForTest();
    const spa = Object.values(Template.fromStack(site).findResources('AWS::CloudFront::Function')).find(
      (resource) => String(resource.Properties.Name ?? '').includes('SpaRewrite') ||
        String(resource.Properties.FunctionConfig?.Comment ?? '').startsWith('Serve index.html'),
    );
    const handler = new Function(`${String(spa?.Properties.FunctionCode)}; return handler;`)() as (event: {
      request: { uri: string };
    }) => { uri?: string };
    const rewrite = (uri: string): string | undefined => handler({ request: { uri } }).uri;

    expect(rewrite('/invite/abc')).toBe('/index.html');
    expect(rewrite('/schedule')).toBe('/index.html');
    expect(rewrite('/manifest.json')).toBe('/manifest.json');
    expect(rewrite('/.well-known/apple-app-site-association')).toBe('/.well-known/apple-app-site-association');
    expect(rewrite('/.well-known/assetlinks.json')).toBe('/.well-known/assetlinks.json');
  });

  it('forwards socket connects to the WebSocket stage with the origin secret', () => {
    const { site } = siteStackForTest();
    const template = Template.fromStack(site);
    const config = distributionConfig(template);

    const socketOrigins = config.Origins.filter((origin) => origin.OriginCustomHeaders !== undefined);
    expect(socketOrigins).toHaveLength(1);
    const socketOrigin = socketOrigins[0]!;
    expect(socketOrigin.OriginAccessControlId).toBeUndefined();
    expect(socketOrigin.OriginCustomHeaders?.map((header) => header.HeaderName)).toEqual(['x-origin-verify']);
    // The value is resolved from Parameter Store at deploy time, so the template holds only its name.
    const [ssmParameter] = Object.entries(template.toJSON().Parameters as Record<string, { Type: string; Default?: string }>)
      .filter(([, parameter]) => parameter.Default === '/gameplan/socket-origin-verify');
    expect(ssmParameter?.[1].Type).toBe('AWS::SSM::Parameter::Value<String>');
    expect(socketOrigin.OriginCustomHeaders?.[0]?.HeaderValue).toEqual({ Ref: ssmParameter?.[0] });

    const socketBehavior = config.CacheBehaviors?.find((behavior) => behavior.PathPattern === '/api/socket');
    expect(socketBehavior?.ViewerProtocolPolicy).toBe('https-only');

    const code = Object.values(template.findResources('AWS::CloudFront::Function'))
      .map((resource) => String(resource.Properties.FunctionCode))
      .join('\n');
    expect(code).toContain("request.uri = '/prod'");
  });

  it('rate-limits socket connects per IP apart from anonymous API calls', () => {
    const { site } = siteStackForTest();
    const acl = Object.values(Template.fromStack(site).findResources('AWS::WAFv2::WebACL'))[0] as {
      Properties: { Rules: { Name: string; Priority: number; Statement: unknown }[] };
    };
    const rules = acl.Properties.Rules;
    expect(rules.map((rule) => rule.Name)).toEqual([
      'PerAccessToken',
      'PerAnonymousIp',
      'SocketConnectIp',
      'PerIpFlood',
      'PerCalendarFeed',
      'CalendarFeedIp',
    ]);
    expect(new Set(rules.map((rule) => rule.Priority)).size).toBe(rules.length);

    const socketRule = JSON.stringify(rules.find((rule) => rule.Name === 'SocketConnectIp')?.Statement);
    expect(socketRule).toContain('"SearchString":"/api/socket"');
    expect(socketRule).toContain('"PositionalConstraint":"EXACTLY"');
    const anonymousRule = JSON.stringify(rules.find((rule) => rule.Name === 'PerAnonymousIp')?.Statement);
    expect(anonymousRule).toContain('"SearchString":"/api/socket"');
    expect(anonymousRule).toContain('NotStatement');
    expect(anonymousRule).toContain('"SearchString":"/api/schedule/feeds/"');
    const feedRule = JSON.stringify(rules.find((rule) => rule.Name === 'PerCalendarFeed')?.Statement);
    expect(feedRule).toContain('"UriPath"');
    const floodRule = JSON.stringify(rules.find((rule) => rule.Name === 'PerIpFlood')?.Statement);
    expect(floodRule).toContain('"SearchString":"/api/schedule/feeds/"');
  });

  it('sends a Content-Security-Policy that allows the media bucket and same-origin socket', () => {
    const { site } = siteStackForTest({
      siteHostname: 'staging.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/site',
    });
    const policy = Object.values(
      Template.fromStack(site).findResources('AWS::CloudFront::ResponseHeadersPolicy'),
    )[0] as {
      Properties: {
        ResponseHeadersPolicyConfig: {
          SecurityHeadersConfig: { ContentSecurityPolicy: { ContentSecurityPolicy: unknown; Override: boolean } };
        };
      };
    };
    const csp = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy;
    expect(csp.Override).toBe(true);
    const value = JSON.stringify(csp.ContentSecurityPolicy);
    expect(value).toContain("default-src 'self'");
    expect(value).toContain("frame-ancestors 'none'");
    expect(value).toContain("object-src 'none'");
    expect(value).toContain('wss://staging.example.com');
    expect(value).toContain('.s3.us-east-1.amazonaws.com');
    expect(value).not.toContain('unsafe-eval');
    expect(value).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
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
    const socketUrl = Object.entries(outputs).find(([key]) => key.includes('SiteWebSocketUrl'))?.[1];
    expect(socketUrl?.Value).toBe('wss://staging.example.com/api/socket');
  });
});

/** Distribution config fields these tests read. */
type DistributionConfig = {
  CacheBehaviors?: { PathPattern: string; ViewerProtocolPolicy?: string }[];
  CustomErrorResponses?: unknown[];
  Origins: {
    DomainName: unknown;
    OriginAccessControlId?: unknown;
    S3OriginConfig?: unknown;
    OriginCustomHeaders?: { HeaderName: string; HeaderValue: unknown }[];
  }[];
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
