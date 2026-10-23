/**
 * Unit tests for Parameter Store name mapping and stack-output loading.
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { GamePlanPlatform } from './gameplan-stack';
import { envFromOutputs, envFromParameters, formatGithubEnv, missingEnv, REQUIRED_CLIENT_ENV } from './ssm-parameters';
import { siteStackForTest } from './test-fixtures';

describe('ssm parameters', () => {
  it('maps names under the prefix and ignores unknown keys', () => {
    const env = envFromParameters('/gameplan', [
      { name: '/gameplan/hosted-zone-id', value: 'Z0123456789ABCDEFGHIJ' },
      { name: '/gameplan/hosted-zone-name', value: 'example.com' },
      { name: '/gameplan/google-client-id', value: 'client-id' },
      { name: '/gameplan/google-client-secret', value: 'secret' },
      { name: '/gameplan/client-origin', value: 'https://app.example.com' },
      { name: '/gameplan/not-used', value: 'skip' },
      { name: '/other/google-client-id', value: 'nope' },
    ]);
    expect(env).toEqual({
      HOSTED_ZONE_ID: 'Z0123456789ABCDEFGHIJ',
      HOSTED_ZONE_NAME: 'example.com',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
  });

  it('accepts a prefix that already ends with a slash', () => {
    const env = envFromParameters('/gameplan/', [{ name: '/gameplan/hosted-zone-id', value: 'Z0123' }]);
    expect(env.HOSTED_ZONE_ID).toBe('Z0123');
  });

  it('ignores parameters that stack outputs used to publish', () => {
    const env = envFromParameters('/gameplan', [
      { name: '/gameplan/api-base-url', value: 'https://app.example.com/api' },
      { name: '/gameplan/site-bucket-name', value: 'site-bucket' },
      { name: '/gameplan/site-certificate-arn', value: 'arn:aws:acm:us-east-1:1:certificate/site' },
    ]);
    expect(env).toEqual({});
  });

  it('reports blank required client variables', () => {
    expect(missingEnv({ API_BASE_URL: ' https://app.example.com/api ' }, ['API_BASE_URL', 'SITE_BUCKET_NAME'])).toEqual([
      'SITE_BUCKET_NAME',
    ]);
    expect(missingEnv({ API_BASE_URL: '' }, REQUIRED_CLIENT_ENV)).toEqual([
      'API_BASE_URL',
      'WS_BASE_URL',
      'SITE_BUCKET_NAME',
      'SITE_DISTRIBUTION_ID',
    ]);
  });

  it('writes multiline values with a GitHub environment delimiter', () => {
    const block = formatGithubEnv({
      CLIENT_ORIGIN: 'https://app.example.com',
      APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nline\n-----END PRIVATE KEY-----',
    });
    expect(block).toContain('CLIENT_ORIGIN=https://app.example.com\n');
    expect(block).toContain('APPLE_PRIVATE_KEY<<GP_SSM_EOF\n');
    expect(block).toContain('-----BEGIN PRIVATE KEY-----\nline\n-----END PRIVATE KEY-----\nGP_SSM_EOF\n');
  });

  it('reads client settings from every stack in the outputs file', () => {
    expect(
      envFromOutputs({
        GamePlanDns: { SiteCertificateArn: 'arn:aws:acm:us-east-1:1:certificate/site' },
        GamePlanApi: { ApiWebSocketUrl1A2B3C4D: 'wss://abc.execute-api.us-east-1.amazonaws.com/prod' },
        GamePlanSite: {
          HttpApiUrl: 'https://app.example.com/api',
          SiteWebSocketUrl: 'wss://app.example.com/api/socket',
          SiteBucketName: 'site-bucket',
          SiteDistributionId: 'E123',
          SiteUrl: 'https://app.example.com',
        },
      }),
    ).toEqual({
      API_BASE_URL: 'https://app.example.com/api',
      WS_BASE_URL: 'wss://app.example.com/api/socket',
      SITE_BUCKET_NAME: 'site-bucket',
      SITE_DISTRIBUTION_ID: 'E123',
    });
  });

  it('reads nested construct outputs whose logical ids include a hash', () => {
    expect(
      envFromOutputs({
        GamePlanSite: {
          WebsiteSiteBucketNameA0602231: 'site-bucket',
          WebsiteSiteDistributionIdC5FF3B81: 'E123',
          WebsiteHttpApiUrl1A2B3C4D: 'https://app.example.com/api',
          WebsiteSiteBucketNamesuffix: 'ignored',
        },
      }),
    ).toEqual({
      SITE_BUCKET_NAME: 'site-bucket',
      SITE_DISTRIBUTION_ID: 'E123',
      API_BASE_URL: 'https://app.example.com/api',
    });
  });

  it('finds the Terraform state bucket in the platform template', () => {
    const platform = new GamePlanPlatform(new cdk.App(), 'GamePlanPlatform', {
      corsOrigin: 'https://staging.example.com',
      callbackUrls: ['https://staging.example.com/api/identity/oauth/callback'],
      logoutUrls: ['https://staging.example.com/login'],
    });
    const keys = Object.keys(Template.fromStack(platform).toJSON().Outputs as object);
    const env = envFromOutputs({ GamePlanPlatform: Object.fromEntries(keys.map((key) => [key, 'value'])) });
    expect(env.TF_STATE_BUCKET).toBe('value');
  });

  it('finds the site settings in the site template', () => {
    const { site } = siteStackForTest();
    const keys = Object.keys(Template.fromStack(site).toJSON().Outputs as object);
    const env = envFromOutputs({ GamePlanSite: Object.fromEntries(keys.map((key) => [key, 'value'])) });
    expect(missingEnv(env, REQUIRED_CLIENT_ENV)).toEqual([]);
  });
});
